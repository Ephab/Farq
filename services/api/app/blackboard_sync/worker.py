"""Background Blackboard sync: one job per student, a failure policy that never locks the IAU
account, and a periodic tick. Failure reasons are codes; the UI words them."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import BlackboardConnection, now
from ..student_memory import disabled_connectors
from . import credentials, files, ingest
from .browser import BlackboardBrowser, ExtractFailure, LoginFailure, PlaywrightBrowser

logger = logging.getLogger(__name__)
SYNC_INTERVAL = timedelta(hours=6)
RETRY_UNREACHABLE = timedelta(hours=1)
MAX_FAILED_LOGINS = 3
TICK_SECONDS = 600
RUNNING_STATES = {"queued", "logging_in", "extracting", "reading_files", "saving"}

def screenshot_path(student_id: str) -> Path:
    """Where the last 'extra step' screenshot lives: on this computer only, never in the DB or a log."""
    base = os.getenv("WAYPOINT_BB_DEBUG_DIR", "").strip()
    folder = Path(base) if base else Path(__file__).resolve().parents[4] / ".blackboard-debug"
    return folder / f"{re.sub(r'[^A-Za-z0-9_-]', '_', student_id)}.png"


def clear_screenshot(student_id: str) -> None:
    screenshot_path(student_id).unlink(missing_ok=True)


def _save_screenshot(student_id: str, data: bytes) -> None:
    path = screenshot_path(student_id)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    except OSError:
        logger.warning("Could not save the Blackboard sign-in screenshot")


browser_factory: Callable[[], BlackboardBrowser] = PlaywrightBrowser
_lock = threading.Lock()
_running: set[str] = set()


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


def is_running(student_id: str) -> bool:
    with _lock:
        return student_id in _running


def start(student_id: str, password: str | None, remember: bool, *, background: bool = True) -> bool:
    """Start a sync unless one is already running for this student (single-flight)."""
    with _lock:
        if student_id in _running:
            return False
        _running.add(student_id)
    if background:
        threading.Thread(target=_guarded, args=(student_id, password, remember),
                         name=f"blackboard-{student_id[:8]}", daemon=True).start()
    else:
        _guarded(student_id, password, remember)
    return True


def _guarded(student_id: str, password: str | None, remember: bool) -> None:
    try:
        run_sync(student_id, password, remember)
    except Exception as exc:  # never log the message: it can echo page content
        logger.error("Blackboard sync crashed for %s (%s)", student_id, type(exc).__name__)
        _update(student_id, status="failed", failure_reason="extract_failed", stage_detail="",
                next_sync_at=now() + RETRY_UNREACHABLE)
    finally:
        with _lock:
            _running.discard(student_id)


def _update(student_id: str, **fields) -> None:
    db = SessionLocal()
    try:
        conn = db.get(BlackboardConnection, student_id)
        if conn is not None:
            for key, value in fields.items():
                setattr(conn, key, value)
            db.commit()
    finally:
        db.close()


def _login_failed(conn: BlackboardConnection, code: str, used_saved_password: bool) -> None:
    conn.status, conn.failure_reason, conn.stage_detail = "failed", code, ""
    conn.next_sync_at = None
    if code == "bad_password":
        conn.failed_logins += 1
        credentials.clear_session(conn)
        # A saved password that IAU rejects is wrong for good (changed password): never retry it.
        if used_saved_password or conn.failed_logins >= MAX_FAILED_LOGINS:
            credentials.forget_password(conn)
    elif code == "needs_login":
        credentials.clear_session(conn)
    elif code == "unreachable":
        conn.next_sync_at = now() + RETRY_UNREACHABLE


def run_sync(student_id: str, password: str | None, remember: bool) -> None:
    db = SessionLocal()
    try:
        conn = db.get(BlackboardConnection, student_id)
        if conn is None:
            return
        conn.status, conn.failure_reason, conn.stage_detail = "logging_in", None, ""
        db.commit()
        clear_screenshot(student_id)
        saved = None if password else credentials.saved_password(conn)
        summary_only, already_read = ingest.sync_hints(db, student_id)
        try:
            result = browser_factory().run(
                username=conn.username, password=password or saved, session_state=credentials.saved_session(conn),
                pick_attachments=lambda export: files.select_attachments(export, already_read),
                progress=lambda stage, detail: _update(student_id, status=stage, stage_detail=detail[:200]),
                summary_only=summary_only,
            )
        except LoginFailure as failure:
            db.refresh(conn)
            _login_failed(conn, failure.code, used_saved_password=saved is not None)
            if failure.stale_session:
                credentials.clear_session(conn)  # the next attempt starts without the old cookies
            if failure.code == "extra_verification":
                conn.stage_detail = (failure.detail or "")[:200]
                if failure.screenshot:
                    _save_screenshot(student_id, failure.screenshot)
            db.commit()
            return
        except ExtractFailure:
            db.refresh(conn)
            conn.status, conn.failure_reason, conn.stage_detail = "failed", "extract_failed", ""
            conn.next_sync_at = now() + RETRY_UNREACHABLE
            db.commit()
            return
        db.refresh(conn)
        conn.failed_logins = 0
        credentials.save_session(conn, result.session_state)
        # Remember a typed password only once IAU has accepted it (a saved session skips the form).
        if password and remember and result.password_verified and credentials.can_remember():
            credentials.remember_password(conn, password)
        elif password and not remember:
            credentials.forget_password(conn)
        conn.status = "saving"
        db.commit()
        texts = {key: text for key, (name, data) in result.files.items() if (text := files.extract_text(name, data))}
        try:
            summary = ingest.ingest_export(db, student_id, result.export, texts)
        except ValueError:
            db.rollback()
            conn = db.get(BlackboardConnection, student_id)
            conn.status, conn.failure_reason = "failed", "extract_failed"
            conn.next_sync_at = now() + RETRY_UNREACHABLE
            db.commit()
            return
        conn.summary_json = json.dumps(summary.as_dict())
        conn.status, conn.failure_reason, conn.stage_detail = "done", None, ""
        conn.last_synced_at = now()
        conn.next_sync_at = now() + SYNC_INTERVAL
        db.commit()
    finally:
        db.close()


def due_students(db: Session) -> list[str]:
    current = now()
    rows = db.scalars(select(BlackboardConnection).where(BlackboardConnection.next_sync_at.is_not(None))).all()
    return [row.student_id for row in rows
            if row.auto_sync and _aware(row.next_sync_at) <= current and row.status not in RUNNING_STATES
            and "blackboard" not in disabled_connectors(db, row.student_id)]


def tick() -> None:
    db = SessionLocal()
    try:
        due = due_students(db)
    finally:
        db.close()
    for student_id in due:
        start(student_id, None, True)


async def sync_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception as exc:
            logger.error("Blackboard periodic sync tick failed (%s)", type(exc).__name__)
        await asyncio.sleep(TICK_SECONDS)


def reset_interrupted(db: Session) -> None:
    """A sync cut off by a restart is reported as failed (retryable), not a spinner forever."""
    for conn in db.scalars(select(BlackboardConnection).where(BlackboardConnection.status.in_(RUNNING_STATES))).all():
        conn.status, conn.failure_reason, conn.stage_detail = "failed", "interrupted", ""
    db.commit()
