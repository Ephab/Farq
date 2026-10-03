"""Read-only Blackboard snapshot used by Hermes during the demo.

No Blackboard credentials, cookies, or live requests exist here. A host-side
importer normalizes approved local course material into these tables; the same
contract can later be populated by an official Blackboard 3LO connector.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .database import get_db
from .decisions import DecisionItem, observe_items, rerank
from .internal_auth import require_internal as _require_internal
from .ownership import OwnedStudent
from .hermes_connectors import BlackboardGrant
from .tool_grants import student_for
from .models import BlackboardContentItem, BlackboardCourse, DataSource, Student, now


router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
MAX_BODY_CHARS = 120_000
READ_CHUNK_CHARS = 12_000
CONTENT_TYPES = {"announcement", "syllabus", "lecture", "document", "assignment"}
DEMO_FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "blackboard-demo.json"


Internal = Annotated[None, Depends(_require_internal)]


class BlackboardImportItem(BaseModel):
    external_id: str = Field(min_length=1, max_length=200)
    parent_external_id: str | None = Field(default=None, max_length=200)
    content_type: Literal["announcement", "syllabus", "lecture", "document", "assignment"]
    title: str = Field(min_length=1, max_length=300)
    body_text: str = Field(default="", max_length=MAX_BODY_CHARS)
    filename: str = Field(default="", max_length=300)
    mime_type: str = Field(default="text/plain", max_length=120)
    source_ref: str = Field(default="", max_length=500)
    origin: Literal["local_material", "synthetic"] = "local_material"
    checksum: str | None = Field(default=None, max_length=64)
    posted_at: datetime | None = None
    due_at: datetime | None = None
    modified_at: datetime | None = None


class BlackboardImportCourse(BaseModel):
    external_id: str = Field(min_length=1, max_length=160)
    code: str = Field(default="", max_length=80)
    title: str = Field(min_length=1, max_length=240)
    term: str = Field(default="", max_length=120)
    description: str = ""
    items: list[BlackboardImportItem] = Field(default_factory=list, max_length=500)


class BlackboardImportPayload(BaseModel):
    student_id: str
    courses: list[BlackboardImportCourse] = Field(min_length=1, max_length=20)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _course_dict(item: BlackboardCourse, count: int | None = None) -> dict:
    result = {
        "id": item.id,
        "external_id": item.external_id,
        "code": item.code,
        "title": item.title,
        "term": item.term,
        "description": item.description,
        "source_kind": item.source_kind,
        "is_current": bool(item.is_current),
        "instructors": json.loads(item.instructors_json or "[]"),
        "grade_summary": json.loads(item.grade_summary_json or "{}"),
        "url": item.url,
        "updated_at": _iso(item.updated_at),
    }
    if count is not None:
        result["content_count"] = count
    return result


def _mode(courses: list[BlackboardCourse]) -> str:
    return "live" if any(course.source_kind == "blackboard_live" for course in courses) else "preindexed_demo"


def _item_meta(item: BlackboardContentItem, course: BlackboardCourse | None = None, snippet: str | None = None) -> dict:
    result = {
        "id": item.id,
        "external_id": item.external_id,
        "course_id": item.course_id,
        "content_type": item.content_type,
        "title": item.title,
        "filename": item.filename,
        "mime_type": item.mime_type,
        "source_ref": item.source_ref,
        "origin": item.origin,
        "posted_at": _iso(item.posted_at),
        "due_at": _iso(item.due_at),
        "modified_at": _iso(item.modified_at),
    }
    if course is not None:
        result["course"] = {"id": course.id, "code": course.code, "title": course.title}
    if snippet is not None:
        result["snippet"] = snippet
    return result


def _student(db: Session, student_id: str) -> Student:
    item = db.get(Student, student_id)
    if item is None:
        raise HTTPException(404, "Student not found")
    return item


def _course(db: Session, student_id: str, course_id: str) -> BlackboardCourse:
    item = db.scalar(select(BlackboardCourse).where(BlackboardCourse.id == course_id, BlackboardCourse.student_id == student_id))
    if item is None:
        raise HTTPException(404, "Blackboard course not found")
    return item


@router.post("/internal/demo/blackboard/import", dependencies=[Depends(_require_internal)])
def import_snapshot(body: BlackboardImportPayload, db: Db) -> dict:
    _student(db, body.student_id)
    source = db.scalar(select(DataSource).where(DataSource.student_id == body.student_id, DataSource.kind == "blackboard_demo"))
    if source is None:
        source = DataSource(
            student_id=body.student_id,
            kind="blackboard_demo",
            label="Blackboard demo snapshot",
            config_json=json.dumps({"mode": "preindexed", "read_only": True}),
            status="ready",
        )
        db.add(source)
    imported = 0
    observations: list[DecisionItem] = []
    incoming_course_ids: set[str] = set()
    for incoming in body.courses:
        incoming_course_ids.add(incoming.external_id)
        course = db.scalar(select(BlackboardCourse).where(
            BlackboardCourse.student_id == body.student_id,
            BlackboardCourse.external_id == incoming.external_id,
        ))
        if course is None:
            course = BlackboardCourse(student_id=body.student_id, external_id=incoming.external_id, title=incoming.title)
            db.add(course)
            db.flush()
        course.code = incoming.code
        course.title = incoming.title
        course.term = incoming.term
        course.description = incoming.description
        course.updated_at = now()
        incoming_item_ids: set[str] = set()
        for content in incoming.items:
            incoming_item_ids.add(content.external_id)
            item = db.scalar(select(BlackboardContentItem).where(
                BlackboardContentItem.course_id == course.id,
                BlackboardContentItem.external_id == content.external_id,
            ))
            digest = content.checksum or hashlib.sha256(content.body_text.encode("utf-8")).hexdigest()
            if item is None:
                item = BlackboardContentItem(course_id=course.id, external_id=content.external_id, content_type=content.content_type, title=content.title, checksum=digest)
                db.add(item)
            item.parent_external_id = content.parent_external_id
            item.content_type = content.content_type
            item.title = content.title
            item.body_text = content.body_text[:MAX_BODY_CHARS]
            item.filename = content.filename
            item.mime_type = content.mime_type
            item.source_ref = content.source_ref or f"bb://{incoming.external_id}/{content.external_id}"
            item.origin = content.origin
            item.checksum = digest
            item.posted_at = content.posted_at
            item.due_at = content.due_at
            item.modified_at = content.modified_at or now()
            observations.append(DecisionItem(
                entity_type="blackboard", entity_id=f"{incoming.external_id}:{content.external_id}",
                title=content.title, text=f"Course: {incoming.code} {incoming.title}. Type: {content.content_type}. Due: {content.due_at or 'none'}. {content.body_text}",
                student_id=body.student_id,
            ))
            imported += 1
        db.execute(delete(BlackboardContentItem).where(
            BlackboardContentItem.course_id == course.id,
            BlackboardContentItem.external_id.not_in(incoming_item_ids),
        ))
    stale_courses = db.scalars(select(BlackboardCourse).where(
        BlackboardCourse.student_id == body.student_id,
        BlackboardCourse.external_id.not_in(incoming_course_ids),
    )).all()
    for stale in stale_courses:
        db.delete(stale)
    source.status = "ready"
    source.error = None
    source.last_synced_at = now()
    observe_items(db, observations, purpose="blackboard_ingestion")
    db.commit()
    return {"status": "ready", "student_id": body.student_id, "courses": len(body.courses), "items": imported}


def seed_demo_snapshot(db: Session, fixture_path: Path = DEMO_FIXTURE_PATH) -> bool:
    """Seed a fresh demo database without replacing locally imported courses."""
    existing = db.scalar(select(BlackboardCourse.id).where(BlackboardCourse.student_id == "demo-student").limit(1))
    if existing is not None:
        return False
    payload = BlackboardImportPayload.model_validate_json(fixture_path.read_text(encoding="utf-8"))
    if payload.student_id != "demo-student":
        raise ValueError("Blackboard demo fixture must target demo-student")
    if any(item.origin != "synthetic" for course in payload.courses for item in course.items):
        raise ValueError("Blackboard demo fixture may contain synthetic records only")
    import_snapshot(payload, db)
    return True


@router.get("/api/students/{student_id}/blackboard/status")
def snapshot_status(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    _student(db, student_id)
    courses = db.scalars(select(BlackboardCourse).where(BlackboardCourse.student_id == student_id)).all()
    mode = _mode(list(courses))
    kind = "blackboard" if mode == "live" else "blackboard_demo"
    source = db.scalar(select(DataSource).where(DataSource.student_id == student_id, DataSource.kind == kind))
    return {
        "connected": bool(courses),
        "mode": mode,
        "read_only": True,
        "courses": len(courses),
        "last_synced_at": _iso(source.last_synced_at) if source else None,
    }


@router.get("/internal/hermes/students/{student_id}/blackboard/courses")
def list_courses(student_id: str, db: Db, grant: BlackboardGrant) -> dict:
    student_id = student_for(db, grant, student_id)
    _student(db, student_id)
    courses = db.scalars(select(BlackboardCourse).where(BlackboardCourse.student_id == student_id).order_by(BlackboardCourse.code, BlackboardCourse.title)).all()
    result = []
    for course in courses:
        count = len(db.scalars(select(BlackboardContentItem.id).where(BlackboardContentItem.course_id == course.id)).all())
        result.append(_course_dict(course, count))
    return {"mode": _mode(list(courses)), "read_only": True, "courses": result}


@router.get("/internal/hermes/students/{student_id}/blackboard/courses/{course_id}/content")
def list_content(
    student_id: str,
    course_id: str,
    db: Db,
    grant: BlackboardGrant,
    content_type: str | None = None,
    limit: int = Query(default=30, ge=1, le=50),
) -> dict:
    course = _course(db, student_for(db, grant, student_id), course_id)
    query = select(BlackboardContentItem).where(BlackboardContentItem.course_id == course.id)
    if content_type:
        if content_type not in CONTENT_TYPES:
            raise HTTPException(422, "Unknown Blackboard content type")
        query = query.where(BlackboardContentItem.content_type == content_type)
    order = ((BlackboardContentItem.due_at.is_(None), BlackboardContentItem.due_at) if content_type == "assignment"
             else (BlackboardContentItem.modified_at.desc(), BlackboardContentItem.title))
    items = db.scalars(query.order_by(*order).limit(limit)).all()
    return {"course": _course_dict(course), "items": [_item_meta(item) for item in items]}


def _snippet(text: str, terms: list[str], width: int = 360) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    lowered = compact.lower()
    positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
    start = max(0, (min(positions) if positions else 0) - 80)
    return compact[start:start + width]


@router.get("/internal/hermes/students/{student_id}/blackboard/search")
def search_content(
    student_id: str,
    db: Db,
    grant: BlackboardGrant,
    query: str = Query(min_length=2, max_length=160),
    course_id: str | None = None,
    limit: int = Query(default=8, ge=1, le=20),
) -> dict:
    student_id = student_for(db, grant, student_id)
    _student(db, student_id)
    terms = [term.lower() for term in re.findall(r"[\w-]+", query) if len(term) > 1]
    if not terms:
        raise HTTPException(422, "Search query has no usable terms")
    courses = db.scalars(select(BlackboardCourse).where(BlackboardCourse.student_id == student_id)).all()
    course_map = {course.id: course for course in courses}
    if course_id and course_id not in course_map:
        raise HTTPException(404, "Blackboard course not found")
    statement = select(BlackboardContentItem).where(BlackboardContentItem.course_id.in_(course_map))
    if course_id:
        statement = statement.where(BlackboardContentItem.course_id == course_id)
    candidates = db.scalars(statement).all()
    ranked: list[tuple[int, BlackboardContentItem]] = []
    for item in candidates:
        haystack = f"{item.title}\n{item.body_text}".lower()
        score = sum(haystack.count(term) for term in terms)
        if score:
            ranked.append((score, item))
    ranked.sort(key=lambda pair: (-pair[0], pair[1].title.lower()))
    results = [
        {**_item_meta(item, course_map[item.course_id], _snippet(item.body_text, terms)), "score": score}
        for score, item in ranked[:limit]
    ]
    return {
        "query": query,
        "untrusted_content": True,
        "results": rerank(db, results, "blackboard_rerank", student_id=student_id),
    }


@router.get("/internal/hermes/students/{student_id}/blackboard/items/{item_id}")
def read_item(student_id: str, item_id: str, db: Db, grant: BlackboardGrant, cursor: int = Query(default=0, ge=0)) -> dict:
    student_id = student_for(db, grant, student_id)
    item = db.get(BlackboardContentItem, item_id)
    course = db.get(BlackboardCourse, item.course_id) if item else None
    if item is None or course is None or course.student_id != student_id:
        raise HTTPException(404, "Blackboard content item not found")
    body = item.body_text or ""
    chunk = body[cursor:cursor + READ_CHUNK_CHARS]
    next_cursor = cursor + len(chunk) if cursor + len(chunk) < len(body) else None
    return {**_item_meta(item, course), "untrusted_content": True, "text": chunk, "cursor": cursor, "next_cursor": next_cursor, "total_characters": len(body)}


@router.get("/internal/hermes/students/{student_id}/blackboard/updates")
def list_updates(
    student_id: str,
    db: Db,
    grant: BlackboardGrant,
    since: datetime | None = None,
    limit: int = Query(default=15, ge=1, le=50),
) -> dict:
    student_id = student_for(db, grant, student_id)
    _student(db, student_id)
    courses = db.scalars(select(BlackboardCourse).where(BlackboardCourse.student_id == student_id)).all()
    course_map = {course.id: course for course in courses}
    statement = select(BlackboardContentItem).where(BlackboardContentItem.course_id.in_(course_map))
    if since:
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        statement = statement.where(BlackboardContentItem.modified_at >= since)
    items = db.scalars(statement.order_by(BlackboardContentItem.modified_at.desc()).limit(limit)).all()
    return {"since": _iso(since), "items": [_item_meta(item, course_map[item.course_id]) for item in items]}
