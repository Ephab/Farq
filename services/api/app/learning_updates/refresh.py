"""Durable queue with conservative paid-run recovery. Never retry a launch POST."""
from __future__ import annotations
import asyncio
import contextlib
import logging
import json
import os
import re
import threading
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import httpx
from sqlalchemy import select, text, update
from ..database import SessionLocal
from ..models import now
from .catalog import ACTORS, TOPICS, PLATFORMS, payload
from .models import RefreshRun, Subscription
from .service import enabled_platforms, prune, store_posts, subscriptions, utc

log = logging.getLogger(__name__)
ALLOWANCE = 100000
ACTIVE = ("queued", "starting", "running", "unresolved")
SUCCESS = ("empty", "partial", "completed")
TERMINAL = {"SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"}
_task = None
_lock = threading.Lock()


def flag(name: str) -> bool:
    return os.getenv(name, "false").lower() in {"true", "1", "yes"}


def actor_for(platform: str) -> str:
    # Server-only config, restricted to the reviewed actors and their Apify tilde spelling.
    value = os.getenv("APIFY_LEARNING_" + platform.upper() + "_ACTOR", ACTORS[platform])
    if value.replace("~", "/") != ACTORS[platform]:
        return ""
    return value.replace("/", "~")


def configured(platform: str) -> bool:
    return (flag("LEARNING_UPDATES_ENABLED") and flag("LEARNING_UPDATES_ROLLOUT_REVIEWED")
            and bool(os.getenv("APIFY_API_KEY", "").strip()) and bool(actor_for(platform)))


def daily_limit() -> int:
    try:
        value = Decimal(os.getenv("LEARNING_UPDATES_DAILY_BUDGET_USD", "1"))
        return int(value * 1000000) if value.is_finite() and value >= 0 else 0
    except (InvalidOperation, ValueError):
        return 0


def spent(db) -> int:
    midnight = now().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = db.scalars(select(RefreshRun).where(
        (RefreshRun.created_at >= midnight) | (RefreshRun.charged.is_(None)))).all()
    # Old unknown charges still consume today's available budget; never silently expire them.
    return sum(r.charged if r.charged is not None else r.reserved for r in rows)


def demand(db) -> set[tuple[str, str]]:
    result = set()
    for sub in db.scalars(select(Subscription)).all():
        if sub.topic_id in TOPICS:
            result.update((sub.topic_id, p) for p in enabled_platforms(db, sub.student_id))
    return result


def enqueue(topic: str, platform: str, *, manual: bool = False) -> str:
    if not configured(platform):
        return "not_configured"
    with SessionLocal() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        if (topic, platform) not in demand(db):
            return "empty"
        latest = db.scalar(select(RefreshRun).where(RefreshRun.topic_id == topic, RefreshRun.platform == platform)
                           .order_by(RefreshRun.created_at.desc()).limit(1))
        if latest and latest.state in ACTIVE:
            return "running" if latest.state != "unresolved" else "failed"
        interval = timedelta(hours=1 if manual else 6)
        if latest and now() - utc(latest.created_at) < interval:
            return "cooldown"
        if spent(db) + ALLOWANCE > daily_limit():
            return "budget_exhausted"
        good = db.scalar(select(RefreshRun).where(RefreshRun.topic_id == topic, RefreshRun.platform == platform,
            RefreshRun.outcome.in_(SUCCESS)).order_by(RefreshRun.created_at.desc()).limit(1))
        since = max(now() - timedelta(days=7), utc(good.created_at) - timedelta(hours=24)) if good else now() - timedelta(days=7)
        db.add(RefreshRun(topic_id=topic, platform=platform, actor=actor_for(platform), since_at=since, reserved=ALLOWANCE))
        db.commit()  # reservation durable before any paid POST
    return "running"


def request_refresh(student_id: str) -> list[dict]:
    with SessionLocal() as db:
        pairs = [(t, p) for t in subscriptions(db, student_id) for p in enabled_platforms(db, student_id)]
    return [{"topic_id": t, "platform": p, "state": enqueue(t, p, manual=True)} for t, p in pairs]


def status(db, student_id: str) -> dict:
    sources = []
    for topic in subscriptions(db, student_id):
        for platform in enabled_platforms(db, student_id):
            runs = db.scalars(select(RefreshRun).where(RefreshRun.topic_id == topic, RefreshRun.platform == platform)
                .order_by(RefreshRun.created_at.desc()).limit(200)).all()
            last = next((r for r in runs if r.outcome in SUCCESS), None)
            latest = runs[0] if runs else None
            if latest and latest.state in ACTIVE:
                state = "failed" if latest.state == "unresolved" or (latest.state == "starting" and now() - utc(latest.created_at) > timedelta(minutes=5)) else "running"
            elif not configured(platform):
                state = "not_configured"
            elif spent(db) + ALLOWANCE > daily_limit():
                state = "budget_exhausted"
            else:
                state = latest.outcome if latest else "empty"
                state = "completed" if state == "completed" else state
            sources.append({"topic_id": topic, "platform": platform, "state": state,
                "last_successful_at": utc(last.finished_at).isoformat() if last and last.finished_at else None,
                "error": latest.error if latest else None})
    return {"sources": sources, "enabled_platforms": enabled_platforms(db, student_id),
            "configured": {p: configured(p) for p in PLATFORMS}}


class Apify:
    def __init__(self, client=None):
        self.client = client or httpx.Client(timeout=20, follow_redirects=False,
            headers={"Authorization": "Bearer " + os.getenv("APIFY_API_KEY", "").strip()})

    def json(self, method, path, **kwargs):
        with self.client.stream(method, "https://api.apify.com/v2/" + path, **kwargs) as response:
            response.raise_for_status()
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    raise ValueError("Oversized Apify response")
                chunks.append(chunk)
            return json.loads(b"".join(chunks))

    def start(self, run):
        return self.json("POST", f"acts/{run.actor}/runs", params={"timeout": 180,
            "maxTotalChargeUsd": "0.10", "maxItems": 50, "waitForFinish": 0},
            json=payload(run.topic_id, run.platform, utc(run.since_at), utc(run.created_at)))["data"]

    def poll(self, run_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", run_id):
            raise ValueError("Invalid run ID")
        return self.json("GET", f"actor-runs/{run_id}")["data"]

    def items(self, dataset):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", dataset):
            raise ValueError("Invalid dataset ID")
        rows = self.json("GET", f"datasets/{dataset}/items", params={"limit": 50, "clean": "true", "format": "json"})
        if not isinstance(rows, list):
            raise ValueError("Invalid dataset")
        return rows[:50]

    def close(self):
        self.client.close()


def charge(data) -> int | None:
    # Do not release a reservation until Apify reports a finite nonnegative total.
    try:
        cost = Decimal(str(data["usageTotalUsd"]))
        return int((cost * 1000000).to_integral_value(rounding=ROUND_CEILING)) if cost.is_finite() and cost >= 0 else None
    except (KeyError, InvalidOperation, ValueError):
        return None


def process(run_id: str, api) -> None:
    with SessionLocal() as db:
        db.execute(text("BEGIN IMMEDIATE"))
        run = db.get(RefreshRun, run_id)
        if run is None or run.state == "finished" or run.state == "unresolved":
            return
        launching = run.state == "queued"
        if run.state == "starting":
            # Another worker owns the launch; this state is never retried, even after restart.
            return
        if launching:
            if not configured(run.platform) or (run.topic_id, run.platform) not in demand(db):
                run.state, run.outcome, run.charged, run.finished_at = "finished", "not_configured", 0, now()
                db.commit()
                return
            run.state = "starting"
            db.commit()
        else:
            db.commit()
        try:
            data = api.start(run) if launching else api.poll(run.apify_run_id)
            remote_id = data.get("id")
            if not isinstance(remote_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", remote_id):
                raise ValueError("Invalid actor run")
            if not launching and remote_id != run.apify_run_id:
                raise ValueError("Mismatched actor run")
            # Persist ID before reading dataset; a dataset timeout must only re-poll this run.
            run.apify_run_id = remote_id
            run.dataset_id = data.get("defaultDatasetId")
            run.state = "running"
            run.error = None
            db.commit()
            if data.get("status") not in TERMINAL:
                return
            rows = api.items(run.dataset_id) if data.get("status") == "SUCCEEDED" else []
            db.execute(text("BEGIN IMMEDIATE"))
            db.refresh(run)
            if run.state == "finished":
                return
            count, rejected = store_posts(db, rows, run.topic_id, run.platform, utc(run.since_at), utc(run.created_at))
            run.count = count
            run.charged = charge(data)
            run.outcome = ("partial" if rejected and count else "failed" if rejected else "completed" if count else "empty") if data.get("status") == "SUCCEEDED" else "failed"
            run.state, run.finished_at = "finished", now()
            run.error = "Some source records failed validation" if rejected else ("Actor did not succeed" if run.outcome == "failed" else None)
            prune(db)
            db.commit()
        except Exception:
            db.rollback()
            db.refresh(run)
            # Never persist exception strings: HTTP errors can include credentials/response bodies.
            if run.state == "starting":
                run.state = "unresolved"
                run.error = "Launch outcome unknown; reservation held for local operator review"
            elif run.state != "finished":
                run.error = "Refresh unavailable; cached updates preserved"
            db.commit()


def reconcile(run_id, api):
    with SessionLocal() as db:
        run = db.get(RefreshRun, run_id)
        try:
            data = api.poll(run.apify_run_id)
            if data.get("id") == run.apify_run_id and data.get("status") in TERMINAL:
                run.charged = charge(data)
                db.commit()
        except Exception:
            db.rollback()  # unresolved charges continue to reserve their allowance


def tick(api=None) -> None:
    if not _lock.acquire(blocking=False):
        return
    owned_api = api is None
    api = api or Apify()
    try:
        with SessionLocal() as db:
            # A process may die after POST but before persisting its ID. Never retry that launch.
            db.execute(update(RefreshRun).where(RefreshRun.state == "starting",
                RefreshRun.created_at < now() - timedelta(minutes=5)).values(state="unresolved",
                error="Launch outcome unknown; reservation held for local operator review"))
            unsettled = list(db.scalars(select(RefreshRun.id).where(RefreshRun.state == "finished",
                RefreshRun.charged.is_(None), RefreshRun.apify_run_id.is_not(None))).all())
            pending = list(db.scalars(select(RefreshRun.id).where(RefreshRun.state.in_(("queued", "running"))).order_by(RefreshRun.created_at)).all())
            pairs = demand(db)
            latest = {}
            for run in db.scalars(select(RefreshRun).order_by(RefreshRun.created_at)).all():
                latest[(run.topic_id, run.platform)] = utc(run.created_at)
            prune(db)
            db.commit()
        # Known paid runs are recovered regardless of rollout flag; disabling does not hide charges.
        if os.getenv("APIFY_API_KEY", "").strip():
            for run_id in unsettled:
                reconcile(run_id, api)
            for run_id in pending:
                process(run_id, api)
        # Least recently attempted sources first: no starvation when the daily budget is small.
        ordered = sorted(pairs, key=lambda pair: (latest.get(pair, now() - timedelta(days=3650)), pair))
        for topic, platform in ordered:
            enqueue(topic, platform)
    finally:
        if owned_api:
            api.close()
        _lock.release()


async def loop():
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            log.warning("Learning updates tick failed; durable queue retained")
        await asyncio.sleep(60)


def start_scheduler():
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(loop())


async def stop_scheduler():
    global _task
    if _task:
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _task
        _task = None
