"""My Data > Blackboard: start a sync, read its status, forget the login. Owner-only routes.

Credentials arrive once in the POST body and go straight to the worker; responses never carry them.
Validation is manual so a rejected password is never echoed back in a 422 body."""
from __future__ import annotations

import json
import re
from datetime import timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import BlackboardContentItem, BlackboardConnection, BlackboardCourse, Student, now
from ..ownership import OwnedStudent
from ..student_memory import disabled_connectors
from . import credentials, worker

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
MAX_USERNAME = 120
MAX_PASSWORD = 256
# InProgress is an unsubmitted draft in Blackboard: it stays on the deadlines list.
DONE_STATUSES = {"graded", "needsgrading", "needs_grading", "submitted", "completed"}


class Preferences(BaseModel):
    auto_sync: bool


class SyncRequest(BaseModel):
    username: str | None = None
    password: str | None = None
    remember: bool = True


def _iso(value) -> str | None:
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def status_dict(conn: BlackboardConnection | None) -> dict:
    if conn is None:
        return {"connected": False, "status": "idle", "stage_detail": "", "failure_reason": None, "username": None,
                "has_saved_login": False, "can_remember": credentials.can_remember(), "auto_sync": True,
                "last_synced_at": None, "next_sync_at": None, "summary": {}, "has_screenshot": False}
    return {
        "connected": True, "status": conn.status, "stage_detail": conn.stage_detail, "failure_reason": conn.failure_reason,
        "username": conn.username, "has_saved_login": credentials.saved_password(conn) is not None, "can_remember": credentials.can_remember(),
        "auto_sync": conn.auto_sync,
        "last_synced_at": _iso(conn.last_synced_at), "next_sync_at": _iso(conn.next_sync_at) if conn.auto_sync else None,
        "summary": json.loads(conn.summary_json or "{}"),
        "has_screenshot": conn.failure_reason == "extra_verification" and worker.screenshot_path(conn.student_id).is_file(),
    }


@router.get("/api/students/{student_id}/blackboard/sync")
def sync_status(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    return status_dict(db.get(BlackboardConnection, student_id))


@router.post("/api/students/{student_id}/blackboard/sync", status_code=202)
def start_sync(student_id: str, _owner: OwnedStudent, db: Db, body: SyncRequest | None = None) -> dict:
    if db.get(Student, student_id) is None:
        raise HTTPException(404, "Student not found")
    if "blackboard" in disabled_connectors(db, student_id):
        raise HTTPException(409, "Blackboard is turned off in Settings > Connectors.")
    body = body or SyncRequest()
    if worker.is_running(student_id):
        if (body.username or "").strip() or body.password:
            raise HTTPException(409, "A sync is running. Try again in a minute.")
        return status_dict(db.get(BlackboardConnection, student_id))
    username = (body.username or "").strip()
    password = body.password or None
    if len(username) > MAX_USERNAME or (password and len(password) > MAX_PASSWORD):
        raise HTTPException(422, "Username or password is too long.")
    if (username and not password) or (password and not username):
        raise HTTPException(422, "Enter both your IAU username and password.")
    conn = db.get(BlackboardConnection, student_id)
    if conn is None:
        if not password:
            raise HTTPException(422, "Enter your IAU username and password.")
        conn = BlackboardConnection(student_id=student_id, username=username)
        db.add(conn)
    elif username:
        if username != conn.username:
            credentials.clear_session(conn)
            credentials.forget_password(conn)
            conn.failed_logins = 0
        conn.username = username
    elif not credentials.saved_password(conn) and not credentials.saved_session(conn):
        # Nothing to sign in with: report it as a status so the card shows its localized message and form.
        conn.status, conn.failure_reason, conn.stage_detail = "failed", "needs_login", ""
        conn.next_sync_at = None
        db.commit()
        return status_dict(conn)
    conn.status, conn.failure_reason, conn.stage_detail = "queued", None, ""
    db.commit()
    worker.start(student_id, password, body.remember)
    db.refresh(conn)
    return status_dict(conn)


@router.patch("/api/students/{student_id}/blackboard/preferences")
def set_preferences(student_id: str, body: Preferences, _owner: OwnedStudent, db: Db) -> dict:
    """Turn the periodic sync off or on. "Sync now" keeps working either way; a running sync finishes."""
    conn = db.get(BlackboardConnection, student_id)
    if conn is None:
        raise HTTPException(404, "Blackboard is not connected.")
    conn.auto_sync = body.auto_sync
    if body.auto_sync and conn.next_sync_at is None and conn.status == "done":
        conn.next_sync_at = now() + worker.SYNC_INTERVAL
    db.commit()
    return status_dict(conn)


@router.delete("/api/students/{student_id}/blackboard/connection")
def forget_connection(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    if worker.is_running(student_id):
        raise HTTPException(409, "A sync is running. Try again in a minute.")
    conn = db.get(BlackboardConnection, student_id)
    if conn is not None:
        credentials.clear_session(conn)
        db.delete(conn)
        db.commit()
    worker.clear_screenshot(student_id)
    return {"forgotten": True}


@router.get("/api/students/{student_id}/blackboard/sync/screenshot")
def sign_in_screenshot(student_id: str, _owner: OwnedStudent) -> FileResponse:
    """The page IAU showed instead of Blackboard on the last failed sign-in (owner only, local file)."""
    path = worker.screenshot_path(student_id)
    if not path.is_file():
        raise HTTPException(404, "No sign-in screenshot")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/api/students/{student_id}/blackboard/deadlines")
def deadlines(student_id: str, _owner: OwnedStudent, db: Db, limit: int = 8) -> dict:
    """Upcoming (and up to 7-day overdue) graded work in current courses, soonest first."""
    window_start = now() - timedelta(days=7)
    rows = db.execute(
        select(BlackboardContentItem, BlackboardCourse)
        .join(BlackboardCourse, BlackboardContentItem.course_id == BlackboardCourse.id)
        .where(BlackboardCourse.student_id == student_id, BlackboardCourse.is_current.is_(True),
               BlackboardContentItem.content_type == "assignment", BlackboardContentItem.due_at.is_not(None))
        .order_by(BlackboardContentItem.due_at)
    ).all()
    items = []
    for item, course in rows:
        due = item.due_at if item.due_at.tzinfo else item.due_at.replace(tzinfo=timezone.utc)
        match = re.search(r"^Status:[ \t]*(\S+)", item.body_text or "", re.M)
        done = bool(match) and match.group(1).lower() in DONE_STATUSES
        if due < window_start or done:
            continue
        items.append({"id": item.id, "title": item.title, "course": course.title, "due_at": due.isoformat(),
                      "url": item.url, "overdue": due < now()})
        if len(items) >= max(1, min(limit, 20)):
            break
    return {"items": items}
