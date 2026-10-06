"""Map a BB-Extension export onto Waypoint's Blackboard tables and suggested evidence.

Bulk data (announcements, materials, deadlines, grades) is context for Hermes and Today and never
becomes evidence. Only course-level records become `suggested` EvidenceItems, reviewed like any
other import. Everything from Blackboard is untrusted text. The caller commits.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import BlackboardAttachment, BlackboardConnection, BlackboardContentItem, BlackboardCourse, BlackboardGrade, DataSource, now
from ..sources.pdf_text import redact
from ..schemas import EvidenceIn
from ..sources import store_evidence

LIVE = "blackboard_live"
MAX_BODY_CHARS = 120_000
SYLLABUS = re.compile(r"syllabus|course (outline|spec|plan)|خطة المقرر|توصيف", re.I)
LECTURE = re.compile(r"lecture|week\s*\d+|chapter|slides?|محاضرة|الأسبوع", re.I)
SECTION_SUFFIX = re.compile(r"-[0-9A-Z]{2,5}$")
# Item id prefix -> the extractor source whose success allows deleting stale rows.
PREFIX_SOURCE = {"ann:": "announcements", "asmt:": "columns", "content:": "contents"}
# Past courses rarely change: between full reads a sync refreshes only their grades.
DETAIL_REFRESH = timedelta(days=7)


@dataclass
class IngestSummary:
    courses: int = 0
    current_courses: int = 0
    upcoming_deadlines: int = 0
    overdue: int = 0
    announcements: int = 0
    materials: int = 0
    files_read: int = 0
    files: int = 0
    grades: int = 0
    new_evidence: int = 0
    partial: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


def plain(value) -> str:
    """Readable plain text; older exports still carry HTML in body_text."""
    if not value:
        return ""
    text = str(value)
    if "<" in text and ">" in text:
        text = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", text)
        text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def course_label(name: str) -> str:
    """'Deep Learning-7MA1' and 'Deep Learning-MA01' are sections of one course."""
    stripped = (name or "").strip()
    return SECTION_SUFFIX.sub("", stripped).strip() or stripped


def _dt(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _ok_sources(export: dict) -> set[str]:
    return {s.get("source") for s in export.get("diagnostics", {}).get("sources", []) if s.get("status") == "ok"}


def _delete_course(db: Session, course: BlackboardCourse) -> None:
    db.execute(delete(BlackboardAttachment).where(BlackboardAttachment.course_id == course.id))
    db.execute(delete(BlackboardContentItem).where(BlackboardContentItem.course_id == course.id))
    db.execute(delete(BlackboardGrade).where(BlackboardGrade.course_id == course.id))
    db.delete(course)


FILE_BLOCK = re.compile(r"(?:^|(?<=\n\n))\[File: [^\n]*\]\n")


def _file_blocks(previous: str) -> list[str]:
    """Every stored `[File: name]` block (header and text) from an earlier sync, in order."""
    previous = previous or ""
    starts = [m.start() for m in FILE_BLOCK.finditer(previous)]
    return [previous[start:end].strip() for start, end in zip(starts, starts[1:] + [len(previous)])]


def _carried_block(previous: str, name: str) -> str:
    """The stored `[File: name]` block (header and text) from an earlier sync, or ''.
    Stored bodies are redacted, so a name that redaction changes is looked up redacted too."""
    for candidate in dict.fromkeys((name, redact(name))):
        header = f"[File: {candidate}]\n"
        block = next((block for block in _file_blocks(previous) if block.startswith(header)), "")
        if block:
            return block
    return ""


def _json_dict(value: str | None) -> dict:
    try:
        parsed = json.loads(value or "{}")
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def sync_hints(db: Session, student_id: str) -> tuple[list[str], dict[str, int | None]]:
    """What the next sync may skip.

    - Past courses read in full within DETAIL_REFRESH: the extractor refreshes only their grades.
    - Files whose text an earlier sync already stored: key -> listed size. They are not downloaded
      again while the listing shows the same attachment and size; ingest carries the stored text.
    """
    cutoff = now() - DETAIL_REFRESH
    courses = db.scalars(select(BlackboardCourse).where(
        BlackboardCourse.student_id == student_id, BlackboardCourse.source_kind == LIVE)).all()
    summary_only = []
    for course in courses:
        stamp = _dt(_json_dict(course.metadata_json).get("detail_synced_at"))
        if not course.is_current and stamp is not None and stamp >= cutoff:
            summary_only.append(course.external_id)
    ext_of = {course.id: course.external_id for course in courses}
    if not ext_of:
        return summary_only, {}
    bodies = {(i.course_id, i.external_id): i.body_text or "" for i in db.scalars(select(BlackboardContentItem).where(
        BlackboardContentItem.course_id.in_(list(ext_of)), BlackboardContentItem.external_id.like("content:%"))).all()}
    already_read: dict[str, int | None] = {}
    for att in db.scalars(select(BlackboardAttachment).where(
            BlackboardAttachment.course_id.in_(list(ext_of)), BlackboardAttachment.text_indexed.is_(True))).all():
        if f"[File: {att.filename}]\n" in bodies.get((att.course_id, f"content:{att.content_id}"), ""):
            already_read[f"{ext_of[att.course_id]}:{att.content_id}:{att.external_id}"] = att.size
    return summary_only, already_read


def _items(export: dict, file_texts: dict[str, str], summary: IngestSummary,
           previous: dict[tuple[str, str], str] | None = None, ok_sources: set[str] | frozenset = frozenset()):
    """Yield (course external id, item external id, fields) for every item worth keeping."""
    for a in export.get("announcements", []):
        ident = a.get("announcement_id") or a.get("source_id")
        if not ident:
            continue
        summary.announcements += 1
        yield a.get("course_id"), f"ann:{ident}", {
            "content_type": "announcement", "title": a.get("title") or "(announcement)",
            "body": plain(a.get("body_text") or a.get("body_html")), "url": a.get("url") or "",
            "posted_at": _dt(a.get("created_at")), "due_at": None,
            "modified_at": _dt(a.get("updated_at") or a.get("created_at")),
            "filename": "", "mime_type": "text/plain",
        }
    for a in export.get("assessments", []):
        ident = a.get("source_id") or a.get("column_id") or a.get("content_id")
        if not ident:
            continue
        lines = [f"Type: {a.get('type') or 'Other'}"]
        if a.get("due_date"):
            lines.append(f"Due: {a['due_date']}")
        if a.get("submission_status"):
            lines.append(f"Status: {a['submission_status']}")
        grade = None if a.get("grade") == "" else a.get("grade")
        possible = None if a.get("possible") == "" else a.get("possible")
        if grade is not None or possible is not None:
            lines.append(f"Grade: {'-' if grade is None else grade} / {'-' if possible is None else possible}")
        description = plain(a.get("description"))
        if description:
            lines.append(description)
        yield a.get("course_id"), f"asmt:{ident}", {
            "content_type": "assignment", "title": a.get("title") or "(graded item)",
            "body": "\n".join(lines), "url": a.get("url") or "",
            "posted_at": None, "due_at": _dt(a.get("due_date")), "modified_at": None,
            "filename": "", "mime_type": "text/plain",
        }
    for c in export.get("content", []):
        ident = c.get("content_id")
        if not ident:
            continue
        body = plain(c.get("body_text"))
        attachments = c.get("attachments") or []
        earlier = (previous or {}).get((c.get("course_id"), f"content:{ident}"), "")
        texts = [(att, file_texts.get(f"{c.get('course_id')}:{ident}:{att.get('id')}")) for att in attachments]
        if f"attachments:{c.get('course_id')}" not in ok_sources and not any(text for _, text in texts):
            # The listing was not fully read, so `attachments` may be wrongly empty: keep every earlier block.
            for block in _file_blocks(earlier):
                body = f"{body}\n\n{block}".strip()
            texts = []
        for att, text in texts:
            name = att.get("name") or "attachment"
            if text:
                summary.files_read += 1
                body = f"{body}\n\n[File: {name}]\n{text}".strip()
            else:
                # Not read this run (download failed, size cap): keep what an earlier sync extracted.
                carried = _carried_block(earlier, name)
                if carried:
                    body = f"{body}\n\n{carried}".strip()
        if c.get("type") == "Folder" and not body and not attachments:
            continue
        label = f"{c.get('title') or ''} {c.get('path') or ''}"
        kind = "syllabus" if SYLLABUS.search(label) else "lecture" if LECTURE.search(label) else "document"
        summary.materials += 1
        first = attachments[0] if attachments else {}
        yield c.get("course_id"), f"content:{ident}", {
            "content_type": kind, "title": c.get("title") or "(untitled)", "body": body,
            "url": c.get("url") or "", "posted_at": _dt(c.get("created")), "due_at": None,
            "modified_at": _dt(c.get("modified")),
            "filename": (first.get("name") or "")[:300], "mime_type": (first.get("mime") or "text/plain")[:120],
        }


def course_evidence(courses: list[dict]) -> list[EvidenceIn]:
    """Current courses and completed courses with a final grade, one per course (not per section)."""
    out: list[EvidenceIn] = []
    seen: set[str] = set()
    for c in courses:
        label = course_label(c.get("name") or "")
        if not label:
            continue
        final = c.get("final_grade") or {}
        standing = c.get("grade_summary") or {}
        data: dict = {"name": label, "term": c.get("term_name") or "", "source": "blackboard"}
        if c.get("is_current"):
            state = "current"
            data["status"] = "in_progress"
            if standing.get("percentage") is not None:
                data["running_percentage"] = standing["percentage"]
        elif c.get("course_status") == "completed":
            state = "completed"
            data["grade"] = final.get("text") or (f"{final['percentage']}%" if final.get("percentage") is not None else "")
            if final.get("percentage") is not None:
                data["percentage"] = final["percentage"]
        else:
            continue
        fingerprint = f"blackboard:{state}:{label}"
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        out.append(EvidenceIn(kind="course", title=label[:240], data=data,
                              source_ref=(c.get("url") or "")[:500], fingerprint=fingerprint[:300]))
    return out


def ingest_export(db: Session, student_id: str, export: dict, file_texts: dict[str, str]) -> IngestSummary:
    courses_in = [c for c in export.get("courses", []) if c.get("id")]
    if not courses_in:
        raise ValueError("Blackboard export has no courses; keeping the previous sync")
    summary = IngestSummary(partial=bool(export.get("summary", {}).get("failed_sources")))
    ok_sources = _ok_sources(export)

    for demo in db.scalars(select(BlackboardCourse).where(
            BlackboardCourse.student_id == student_id, BlackboardCourse.source_kind != LIVE)).all():
        _delete_course(db, demo)

    by_ext: dict[str, BlackboardCourse] = {}
    for c in courses_in:
        row = db.scalar(select(BlackboardCourse).where(
            BlackboardCourse.student_id == student_id, BlackboardCourse.external_id == c["id"]))
        if row is None:
            row = BlackboardCourse(student_id=student_id, external_id=c["id"], title=(c.get("name") or c["id"])[:240])
            db.add(row)
            db.flush()
        final = c.get("final_grade")
        row.code = (c.get("code") or "")[:80]
        row.title = (c.get("name") or c["id"])[:240]
        row.term = (c.get("term_name") or "")[:120]
        row.term_id = (c.get("term_id") or "")[:160]
        row.lifecycle = c.get("course_status") if c.get("course_status") in {
            "current", "past", "upcoming", "completed", "unknown"} else "unknown"
        # A summary-only read (a past course read in full recently) refreshed grades alone:
        # keep what only a full read produces.
        summary_only = c.get("detail") == "summary"
        earlier_meta = _json_dict(row.metadata_json)
        metadata = {k: c.get(k) for k in (
            "term_start", "term_end", "availability", "availability_duration", "enrollment_date",
            "current_reasons", "current_score")}
        if not summary_only and f"contents:{c['id']}" in ok_sources:
            metadata["detail_synced_at"] = now().isoformat()
        elif earlier_meta.get("detail_synced_at"):
            metadata["detail_synced_at"] = earlier_meta["detail_synced_at"]
        row.metadata_json = json.dumps(metadata)
        row.source_kind = LIVE
        row.is_current = bool(c.get("is_current"))
        if not summary_only:
            row.instructors_json = json.dumps([{"name": i.get("name"), "email": i.get("email")} for i in c.get("instructors") or []])
        grade_summary = {**(c.get("grade_summary") or {}), **({"final_grade": final} if final else {})}
        if summary_only and "missing" in (earlier_grades := _json_dict(row.grade_summary_json)):
            grade_summary["missing"] = earlier_grades["missing"]  # overdue items come from assessments, not re-read
        row.grade_summary_json = json.dumps(grade_summary)
        row.url = (c.get("url") or "")[:500]
        row.updated_at = now()
        by_ext[c["id"]] = row
    # A filtered export or failed listing never proves that older courses disappeared.
    complete_listing = "memberships" in ok_sources and export.get("summary", {}).get("scope", "all") == "all"
    if complete_listing:
        for stale in db.scalars(select(BlackboardCourse).where(
                BlackboardCourse.student_id == student_id, BlackboardCourse.external_id.not_in(list(by_ext)))).all():
            _delete_course(db, stale)

    seen_files: dict[str, set[tuple[str, str]]] = {ext: set() for ext in by_ext}
    for content in export.get("content", []):
        course_ext, content_id = content.get("course_id"), content.get("content_id")
        if course_ext not in by_ext or not content_id:
            continue
        for att in content.get("attachments") or []:
            if not att.get("id") or not att.get("download_url"):
                continue
            ident = str(att["id"])
            seen_files[course_ext].add((content_id, ident))
            row = db.scalar(select(BlackboardAttachment).where(
                BlackboardAttachment.course_id == by_ext[course_ext].id,
                BlackboardAttachment.content_id == content_id, BlackboardAttachment.external_id == ident))
            if row is None:
                row = BlackboardAttachment(course_id=by_ext[course_ext].id, content_id=content_id, external_id=ident)
                db.add(row)
            row.title = redact(content.get("title") or "")[:300]
            row.filename = redact(att.get("name") or "attachment")[:300]
            row.mime_type = (att.get("mime") or "")[:120]
            row.size = att.get("size") if isinstance(att.get("size"), int) else None
            row.download_url = att["download_url"]
            row.path = redact(content.get("path") or "")
            row.text_indexed = row.text_indexed or bool(file_texts.get(f"{course_ext}:{content_id}:{ident}"))
            row.updated_at = now()
    for course_ext, course in by_ext.items():
        if f"contents:{course_ext}" in ok_sources and f"attachments:{course_ext}" in ok_sources:
            for row in db.scalars(select(BlackboardAttachment).where(BlackboardAttachment.course_id == course.id)).all():
                if (row.content_id, row.external_id) not in seen_files[course_ext]:
                    db.delete(row)

    seen: dict[str, set[str]] = {ext: set() for ext in by_ext}
    ext_of = {row.id: ext for ext, row in by_ext.items()}
    previous = {(ext_of[i.course_id], i.external_id): i.body_text for i in db.scalars(
        select(BlackboardContentItem).where(BlackboardContentItem.course_id.in_(list(ext_of)),
                                            BlackboardContentItem.external_id.like("content:%"))).all()}
    for course_ext, item_ext, fields in _items(export, file_texts, summary, previous, ok_sources):
        course = by_ext.get(course_ext)
        if course is None:
            continue
        seen[course_ext].add(item_ext)
        body = redact(fields.pop("body"))[:MAX_BODY_CHARS]
        digest = hashlib.sha256(f"{fields['title']}\n{body}".encode("utf-8")).hexdigest()
        item = db.scalar(select(BlackboardContentItem).where(
            BlackboardContentItem.course_id == course.id, BlackboardContentItem.external_id == item_ext))
        changed = item is None or item.checksum != digest
        if item is None:
            item = BlackboardContentItem(course_id=course.id, external_id=item_ext, content_type=fields["content_type"],
                                         title=fields["title"][:300], checksum=digest)
            db.add(item)
        modified = fields.pop("modified_at")
        for key, value in fields.items():
            setattr(item, key, value[:300] if key == "title" else value)
        item.body_text = body
        item.origin = LIVE
        item.source_ref = f"bb://{course_ext}/{item_ext}"
        item.checksum = digest
        if changed:
            item.modified_at = modified or now()

    for course_ext, course in by_ext.items():
        allowed = {prefix for prefix, source in PREFIX_SOURCE.items() if f"{source}:{course_ext}" in ok_sources}
        for item in db.scalars(select(BlackboardContentItem).where(BlackboardContentItem.course_id == course.id)).all():
            prefix = next((p for p in PREFIX_SOURCE if item.external_id.startswith(p)), None)
            if prefix in allowed and item.external_id not in seen[course_ext]:
                db.delete(item)

    grades_seen: dict[str, set[str]] = {ext: set() for ext in by_ext}
    for g in export.get("grades", []):
        course = by_ext.get(g.get("course_id"))
        ident = g.get("column_id") or g.get("source_id")
        if course is None or not ident:
            continue
        grades_seen[g["course_id"]].add(ident)
        row = db.scalar(select(BlackboardGrade).where(BlackboardGrade.course_id == course.id, BlackboardGrade.external_id == ident))
        if row is None:
            row = BlackboardGrade(course_id=course.id, external_id=ident, title=(g.get("item") or ident)[:300])
            db.add(row)
        row.title = (g.get("item") or ident)[:300]
        row.score, row.possible, row.percentage = g.get("score"), g.get("possible"), g.get("percentage")
        row.status = (g.get("status") or "")[:32]
        row.feedback = redact(plain(g.get("feedback")))
        row.posted_at = _dt(g.get("posted"))
        summary.grades += 1
    for course_ext, course in by_ext.items():
        if f"usergrades:{course_ext}" in ok_sources:
            for row in db.scalars(select(BlackboardGrade).where(BlackboardGrade.course_id == course.id)).all():
                if row.external_id not in grades_seen[course_ext]:
                    db.delete(row)

    current = {c["id"] for c in courses_in if c.get("is_current")}
    summary.courses = len(courses_in)
    summary.current_courses = len(current)
    db.flush()
    summary.files = len(db.scalars(select(BlackboardAttachment.id).join(BlackboardCourse).where(
        BlackboardCourse.student_id == student_id)).all())
    connection = db.get(BlackboardConnection, student_id)
    if connection is not None:
        # The inspectable snapshot contains all extracted categories, but no identity or secrets.
        def clean(value, key=""):
            if key.lower() in {"user", "username", "userid", "email", "author", "password", "cookies", "samples"}:
                return None
            if isinstance(value, dict):
                return {k: result for k, v in value.items() if (result := clean(v, k)) is not None}
            if isinstance(value, list):
                return [clean(v) for v in value]
            if isinstance(value, str) and not (key.endswith("id") or "url" in key or key in {"code", "courseId"}):
                return redact(value)
            return value
        connection.collection_json = json.dumps(clean({k: v for k, v in export.items()
            if k not in {"user", "assignments", "materials"}}))
    summary.upcoming_deadlines = sum(1 for a in export.get("assessments", []) if a.get("is_upcoming") and a.get("course_id") in current)
    summary.overdue = sum(1 for a in export.get("assessments", []) if a.get("is_overdue") and a.get("course_id") in current)

    source = db.scalar(select(DataSource).where(DataSource.student_id == student_id, DataSource.kind == "blackboard"))
    if source is None:
        source = DataSource(student_id=student_id, kind="blackboard", label="Blackboard",
                            config_json=json.dumps({"read_only": True}), status="ready")
        db.add(source)
        db.flush()
    source.status, source.error, source.last_synced_at = "ready", None, now()
    # A fallback course list lacks authoritative enrollment details: suggest nothing.
    trusted = "memberships" in ok_sources and "courses-fallback" not in ok_sources
    evidence = course_evidence(courses_in) if trusted else []
    summary.new_evidence = store_evidence(db, student_id, source.id, evidence) if evidence else 0
    db.flush()
    return summary
