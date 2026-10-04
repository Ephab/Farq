"""Owner-facing Blackboard inventory and bounded, uncached downloads from catalog URLs."""
from __future__ import annotations

import json
import mimetypes
from urllib.parse import urljoin, urlsplit, quote

from fastapi import HTTPException
from fastapi.responses import Response
from sqlalchemy import select

from ..models import BlackboardAttachment, BlackboardConnection, BlackboardContentItem, BlackboardCourse, BlackboardGrade
from ..ownership import OwnedStudent
from ..student_memory import disabled_connectors
from .credentials import saved_session
from .browser import ORIGIN
from .files import MAX_FILE_BYTES
from .routes import Db, router

# IAU's observed Blackboard file handoff. Keep this exact tenant allowlist;
# neither a course document nor the client can add another storage host.
STORAGE_HOST = "alt-685da65a9aa3e.blackboard.com"


def allowed_file_url(url: str, *, initial: bool = False) -> bool:
    try:
        parts = urlsplit(url)
        hosts = {urlsplit(ORIGIN).hostname} if initial else {urlsplit(ORIGIN).hostname, STORAGE_HOST}
        return (parts.scheme == "https" and parts.hostname in hosts and parts.port in {None, 443}
                and parts.username is None and parts.password is None)
    except ValueError:
        return False


def file_dict(row: BlackboardAttachment, course: BlackboardCourse) -> dict:
    return {"id": row.id, "title": row.title, "filename": row.filename, "mime_type": row.mime_type,
            "size": row.size, "path": row.path, "text_indexed": row.text_indexed,
            "course_id": course.id, "course": course.title, "term": course.term,
            "term_id": course.term_id, "status": course.lifecycle,
            "is_slide": row.filename.lower().endswith((".pdf", ".pptx", ".ppt"))}


@router.get("/api/students/{student_id}/blackboard/collection")
def collection(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    courses = db.scalars(select(BlackboardCourse).where(BlackboardCourse.student_id == student_id)
                         .order_by(BlackboardCourse.term.desc(), BlackboardCourse.title)).all()
    items = db.scalars(select(BlackboardContentItem).join(BlackboardCourse)
                       .where(BlackboardCourse.student_id == student_id)).all()
    grades = db.scalars(select(BlackboardGrade).join(BlackboardCourse)
                        .where(BlackboardCourse.student_id == student_id)).all()
    attachments = db.scalars(select(BlackboardAttachment).join(BlackboardCourse)
                             .where(BlackboardCourse.student_id == student_id)).all()
    conn = db.get(BlackboardConnection, student_id)
    snapshot = json.loads(conn.collection_json or "{}") if conn else {}
    return {"courses": [{"id": c.id, "external_id": c.external_id, "code": c.code, "title": c.title,
                          "term": c.term, "term_id": c.term_id, "status": c.lifecycle,
                          "is_current": c.is_current, "source_kind": c.source_kind,
                          "instructors": json.loads(c.instructors_json or "[]"),
                          "grade_summary": json.loads(c.grade_summary_json or "{}"),
                          "metadata": json.loads(c.metadata_json or "{}"), "url": c.url,
                          "items": [{"id": i.id, "title": i.title, "type": i.content_type,
                                     "text": i.body_text, "filename": i.filename, "url": i.url,
                                     "due_at": i.due_at, "posted_at": i.posted_at, "modified_at": i.modified_at,
                                     "source_ref": i.source_ref} for i in items if i.course_id == c.id],
                          "grades": [{"id": g.id, "title": g.title, "score": g.score, "possible": g.possible,
                                      "percentage": g.percentage, "status": g.status, "feedback": g.feedback,
                                      "posted_at": g.posted_at} for g in grades if g.course_id == c.id],
                          "files": [file_dict(a, c) for a in attachments if a.course_id == c.id]}
                         for c in courses],
            "events": snapshot.get("events", []), "diagnostics": snapshot.get("diagnostics", {}),
            "exported_at": snapshot.get("exported_at"), "has_file_catalog": bool(snapshot),
            "snapshot": snapshot}


@router.get("/api/students/{student_id}/blackboard/slides")
def slides(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    rows = db.execute(select(BlackboardAttachment, BlackboardCourse).join(BlackboardCourse)
                      .where(BlackboardCourse.student_id == student_id)
                      .order_by(BlackboardCourse.term.desc(), BlackboardCourse.title, BlackboardAttachment.path)).all()
    return {"files": [file_dict(a, c) for a, c in rows if a.filename.lower().endswith((".pdf", ".pptx", ".ppt"))]}


def download_bytes(url: str, state: dict) -> bytes:
    # Downloads start on IAU. Only its verified storage tenant may receive a redirect.
    if not allowed_file_url(url, initial=True):
        raise HTTPException(422, "This file URL is not on IAU Blackboard.")
    from playwright.sync_api import Error, sync_playwright
    try:
        with sync_playwright() as pw:
            request = pw.request.new_context(storage_state=state)
            storage_request = None
            try:
                for _ in range(6):
                    if urlsplit(url).hostname == STORAGE_HOST:
                        if storage_request is None:
                            # Signed file URLs authorize the storage request. Never copy the
                            # IAU login cookies, localStorage or other credentials to this host.
                            storage_request = pw.request.new_context()
                        context = storage_request
                    else:
                        context = request
                    response = context.get(url, max_redirects=0, timeout=60_000)
                    if 300 <= response.status < 400:
                        url = urljoin(url, response.headers.get("location", ""))
                        if not allowed_file_url(url):
                            raise HTTPException(409, "This file needs to be opened in Blackboard.")
                        continue
                    if response.status in {401, 403} or "text/html" in response.headers.get("content-type", ""):
                        raise HTTPException(409, "Sign in again from My Data > Blackboard, then retry.")
                    if not response.ok:
                        raise HTTPException(502, "Blackboard could not return this file.")
                    length = response.headers.get("content-length", "")
                    if length.isdigit() and int(length) > MAX_FILE_BYTES:
                        raise HTTPException(413, "Files over 15 MB must be downloaded in Blackboard.")
                    data = response.body()
                    if len(data) > MAX_FILE_BYTES:
                        raise HTTPException(413, "Files over 15 MB must be downloaded in Blackboard.")
                    return data
                raise HTTPException(502, "Blackboard redirected this file too many times.")
            finally:
                if storage_request is not None:
                    storage_request.dispose()
                request.dispose()
    except Error:
        raise HTTPException(502, "Blackboard download failed. Try again.") from None


@router.get("/api/students/{student_id}/blackboard/files/{file_id}/download")
def download(student_id: str, file_id: str, _owner: OwnedStudent, db: Db) -> Response:
    if "blackboard" in disabled_connectors(db, student_id):
        raise HTTPException(409, "Blackboard is turned off in Settings > Connectors.")
    row = db.scalar(select(BlackboardAttachment).join(BlackboardCourse).where(
        BlackboardAttachment.id == file_id, BlackboardCourse.student_id == student_id))
    if row is None:
        raise HTTPException(404, "Blackboard file not found")
    if row.size is not None and row.size > MAX_FILE_BYTES:
        raise HTTPException(413, "Files over 15 MB must be downloaded in Blackboard.")
    conn = db.get(BlackboardConnection, student_id)
    state = saved_session(conn) if conn else None
    if not state:
        raise HTTPException(409, "Sign in again from My Data > Blackboard, then retry.")
    data = download_bytes(row.download_url, state)
    return Response(data, media_type=mimetypes.guess_type(row.filename)[0] or "application/octet-stream",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.filename, safe='')}",
                             "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
