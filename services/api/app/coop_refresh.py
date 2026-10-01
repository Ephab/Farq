"""Live refresh for co-op discovery: scheduler, user-triggered refresh and per-source status.

The sources themselves live in coop.py / coop_sources.py. This module decides *when* they run,
makes sure only one refresh runs at a time, rate-limits the manual button server-side, and
reports honest per-source status (ok / partial / failed / not configured / running / never).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .coop import require_student, sync_coop_source, sync_feed_sources, sync_official_coop_sources
from .database import SessionLocal, get_db
from .models import OpportunitySyncRun, StudentCoopVisit, now
from .ownership import OwnedStudent

logger = logging.getLogger(__name__)
router = APIRouter()
Db = Annotated[Session, Depends(get_db)]

FAST = 30 * 60  # employer feeds and the Telegram archive
SLOW = 6 * 60 * 60  # official pages and the paid LinkedIn actor
RETRY_AFTER_FAILURE = 5 * 60
MANUAL_COOLDOWN = 60  # seconds between user-triggered refreshes, for everyone
INTERRUPTED_AFTER = 15 * 60  # a run with no finish time this old died with its process
TICK = 60


def _flag(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes"}


def _telegram_enabled() -> bool:
    return _flag("COOP_TELEGRAM_ARCHIVE_ENABLED")


def _linkedin_key() -> bool:
    return bool(os.getenv("APIFY_API_KEY", "").strip()) and _flag("COOP_LINKEDIN_ENABLED")


SOURCES: dict[str, dict] = {
    "feeds": {"interval": FAST, "manual_min": 0, "run": lambda db: sync_feed_sources(db), "enabled": lambda: True, "hint": None},
    "telegram": {"interval": FAST, "manual_min": 0, "run": lambda db: sync_coop_source(db, "telegram"), "enabled": _telegram_enabled, "hint": "COOP_TELEGRAM_ARCHIVE_ENABLED"},
    "official": {"interval": SLOW, "manual_min": 0, "run": lambda db: sync_official_coop_sources(db), "enabled": lambda: True, "hint": None},
    # Every LinkedIn run spends Apify credit, so even a manual refresh waits an hour between runs.
    "linkedin": {"interval": SLOW, "manual_min": 3600, "run": lambda db: sync_coop_source(db, "linkedin"), "enabled": _linkedin_key, "hint": "APIFY_API_KEY"},
}

_run_lock = threading.Lock()  # held for the whole life of a refresh
_guard = threading.Lock()  # protects _state / _last_manual
_state: dict = {"id": None, "status": "idle", "trigger": None, "started_at": None, "finished_at": None, "sources": {}}
_last_manual = 0.0
_task: asyncio.Task | None = None


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    value = _aware(value)
    return value.isoformat() if value else None


def snapshot() -> dict:
    with _guard:
        return {**_state, "sources": {key: dict(value) for key, value in _state["sources"].items()}}


def _normalize(result: dict | None) -> str:
    status = (result or {}).get("status", "failed")
    return {"completed": "ok", "empty": "ok", "partial": "partial", "failed": "failed", "not_configured": "not_configured"}.get(status, "failed")


def _worker(keys: list[str]) -> None:
    try:
        for key in keys:
            with _guard:
                _state["sources"][key] = {"status": "running"}
            outcome: dict
            db = SessionLocal()
            try:
                result = SOURCES[key]["run"](db)
                outcome = {"status": _normalize(result), "fetched": result.get("fetched"), "changed": result.get("changed", result.get("inserted")), "error": result.get("error")}
            except Exception as exc:
                db.rollback()
                logger.exception("Co-op refresh failed: %s", key)
                outcome = {"status": "failed", "error": str(exc)[:300]}
            finally:
                db.close()
            with _guard:
                _state["sources"][key] = outcome
    finally:
        with _guard:
            _state["status"] = "done"
            _state["finished_at"] = _iso(now())
        _run_lock.release()


def start_refresh(trigger: str, keys: list[str]) -> tuple[dict, bool]:
    """Start a refresh in a background thread. Returns (state, started); when one is already
    running the current state comes back with started=False."""
    keys = [key for key in keys if key in SOURCES]
    if not keys or not _run_lock.acquire(blocking=False):
        return snapshot(), False
    with _guard:
        _state.update({
            "id": os.urandom(6).hex(), "status": "running", "trigger": trigger,
            "started_at": _iso(now()), "finished_at": None,
            "sources": {key: {"status": "pending"} for key in keys},
        })
    threading.Thread(target=_worker, args=(keys,), name=f"coop-refresh-{trigger}", daemon=True).start()
    return snapshot(), True


def _last_runs(db: Session, key: str) -> tuple[OpportunitySyncRun | None, OpportunitySyncRun | None]:
    runs = db.scalars(select(OpportunitySyncRun).where(OpportunitySyncRun.source == f"coop:{key}").order_by(OpportunitySyncRun.started_at.desc()).limit(25)).all()
    last = runs[0] if runs else None
    last_ok = next((run for run in runs if run.status in {"completed", "partial", "empty"} and run.finished_at), None)
    return last, last_ok


def _status_of(run: OpportunitySyncRun | None) -> str:
    if run is None:
        return "never"
    if run.status == "running" or run.finished_at is None:
        started = _aware(run.started_at)
        return "running" if started and datetime.now(timezone.utc) - started < timedelta(seconds=INTERRUPTED_AFTER) else "failed"
    return _normalize({"status": run.status})


def source_statuses(db: Session) -> list[dict]:
    live = snapshot()
    rows = []
    for key, spec in SOURCES.items():
        last, last_ok = _last_runs(db, key)
        if not spec["enabled"]():
            rows.append({"key": key, "status": "not_configured", "hint": spec["hint"], "last_run_at": None, "last_ok_at": _iso(last_ok.finished_at) if last_ok else None,
                         "fetched": 0, "changed": 0, "error": None, "interval_seconds": spec["interval"], "next_due_at": None})
            continue
        status = _status_of(last)
        if live["status"] == "running" and live["sources"].get(key, {}).get("status") in {"running", "pending"}:
            status = "running"
        error = last.error if last and status in {"failed", "partial"} else None
        if last and status == "failed" and last.finished_at is None:
            error = "interrupted"
        started = _aware(last.started_at) if last else None
        rows.append({
            "key": key, "status": status, "hint": None,
            "last_run_at": _iso(last.finished_at or last.started_at) if last else None,
            "last_ok_at": _iso(last_ok.finished_at) if last_ok else None,
            "fetched": last.fetched_count if last else 0, "changed": last.changed_count if last else 0,
            "error": error, "interval_seconds": spec["interval"],
            "next_due_at": _iso(started + timedelta(seconds=spec["interval"])) if started else None,
        })
    return rows


def due_keys(db: Session) -> list[str]:
    current = datetime.now(timezone.utc)
    due = []
    for key, spec in SOURCES.items():
        if not spec["enabled"]():
            continue
        last, _ = _last_runs(db, key)
        if last is None:
            due.append(key)
            continue
        wait = RETRY_AFTER_FAILURE if _status_of(last) == "failed" else spec["interval"]
        started = _aware(last.started_at)
        if started is None or current - started >= timedelta(seconds=wait):
            due.append(key)
    return due


def scheduler_enabled() -> bool:
    return _flag("COOP_SYNC_ENABLED") and "PYTEST_CURRENT_TEST" not in os.environ


async def scheduler_loop() -> None:
    """Runs from app start. Each tick starts whichever sources are past their interval, judged
    from persisted run history, so a restart picks up where the last process left off."""
    await asyncio.sleep(3)
    while True:
        try:
            def pick() -> list[str]:
                db = SessionLocal()
                try:
                    return due_keys(db)
                finally:
                    db.close()
            keys = await asyncio.to_thread(pick)
            if keys:
                start_refresh("schedule", keys)
        except Exception:
            logger.exception("Co-op scheduler tick failed")
        await asyncio.sleep(TICK)


def start_scheduler() -> None:
    global _task
    if scheduler_enabled() and (_task is None or _task.done()):
        _task = asyncio.create_task(scheduler_loop())


async def stop_scheduler() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None


def manual_refresh(db: Session) -> tuple[dict, bool, int]:
    """User-triggered refresh: (state, started, retry_after_seconds). The cooldown is global
    because the sources are shared by every student."""
    global _last_manual
    with _guard:
        wait = MANUAL_COOLDOWN - (time.monotonic() - _last_manual)
        running = _state["status"] == "running"
    if running:
        return snapshot(), False, 0
    if wait > 0:
        return snapshot(), False, int(wait) + 1
    keys = []
    current = datetime.now(timezone.utc)
    for key, spec in SOURCES.items():
        if not spec["enabled"]():
            continue
        last, _ = _last_runs(db, key)
        started = _aware(last.started_at) if last else None
        if spec["manual_min"] and started and current - started < timedelta(seconds=spec["manual_min"]):
            continue
        keys.append(key)
    state, started_now = start_refresh("manual", keys)
    if started_now:
        with _guard:
            _last_manual = time.monotonic()
    return state, started_now, 0


def _overview(db: Session) -> dict:
    rows = source_statuses(db)
    ok_times = [row["last_ok_at"] for row in rows if row["last_ok_at"]]
    return {
        "sources": rows,
        "refresh": snapshot(),
        "last_updated_at": max(ok_times) if ok_times else None,
        "manual_cooldown_seconds": MANUAL_COOLDOWN,
    }


@router.get("/api/students/{student_id}/coop/sources")
def coop_sources(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    require_student(db, student_id)
    return _overview(db)


@router.post("/api/students/{student_id}/coop/refresh")
def coop_refresh(student_id: str, _owner: OwnedStudent, db: Db):
    require_student(db, student_id)
    state, started, retry_after = manual_refresh(db)
    if retry_after:
        return JSONResponse({"detail": "Co-op sources were refreshed a moment ago. Try again shortly.", "retry_after": retry_after}, status_code=429, headers={"Retry-After": str(retry_after)})
    return JSONResponse({**_overview(db), "started": started}, status_code=202 if started else 200)


@router.post("/api/students/{student_id}/coop/visit")
def coop_visit(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    """Mark everything currently listed as seen; called when the student leaves the view."""
    require_student(db, student_id)
    row = db.get(StudentCoopVisit, student_id)
    stamp = now()
    if row is None:
        db.add(StudentCoopVisit(student_id=student_id, last_visit_at=stamp))
    else:
        row.last_visit_at = stamp
    db.commit()
    return {"last_visit_at": _iso(stamp)}
