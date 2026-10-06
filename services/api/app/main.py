from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from waypoint_collaboration_auth import create_router as collaboration_auth_router
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from .blackboard import router as blackboard_router, seed_demo_snapshot
from .blackboard_sync.routes import router as blackboard_sync_router
from .blackboard_sync import catalog as blackboard_catalog  # registers owner-facing inventory routes
from .blackboard_sync.worker import reset_interrupted as reset_blackboard_syncs, sync_loop as blackboard_sync_loop
from .connections import router as connections_router
from .coop import router as coop_router, seed_coop_catalog
from .coop_refresh import router as coop_refresh_router, start_scheduler as start_coop_scheduler, stop_scheduler as stop_coop_scheduler
from .learning_updates.router import router as learning_updates_router
from .learning_updates.refresh import start_scheduler as start_learning_scheduler, stop_scheduler as stop_learning_scheduler
from .cv import router as cv_router
from .database import Base, SessionLocal, engine, ensure_added_columns, ensure_indexes, get_db
from .decisions import DecisionItem, observe_independently, status as decision_status
from .disciplines import classify_program, public_registry
from . import collab_coach
from .hermes import HERMES_API_KEY, HERMES_URL, LIVE_PROGRESS, HermesJsonError, resolve_hermes_selection, run_agent, saved_choice
from .models import AgentRun, ChatMessage, ChatThread, DataSource, DecisionRecord, EvidenceItem, RoadmapProposal, RoadmapVersion, Student, StudentFact, StudentHermesSettings, StudentMemory, StudentOpportunity, StudentProfile, now, uid
from .onboarding import UPLOAD_KINDS, build_profile_brief, generate_initial_roadmap, mark_synced, sync_remote, sync_upload
from .opportunities.hackathonat import OpportunitySourceError
from .opportunities import find_hackathons, mark_seen, normalize_opportunity_operations, opportunity_summary, recompute_student, sync_hackathonat
from .pipeline.brief_step import readiness as readiness_for
from .pipeline.review_step import decide_evidence as decide_evidence_step
from .roadmap_gen import planner as roadmap_planner
from .roadmap_gen import stage as roadmap_stage
from .roadmap_gen import stitch as roadmap_stitch
from .roadmap_gen import runs as generation_runs
from .roadmap_gen import store as staged_store
from .roadmaps import apply_operations
from .projects import router as projects_router
from .identity import CurrentUser, User, resolve_user, router as identity_router
from .internal_auth import require_internal
from .ownership import OwnedStudent, StreamUser, assert_owner, require_own_message
from .tool_grants import EvidenceGrant, FactsGrant, ProposalsGrant, ReadGrant, student_for
from .hermes_connectors import HackathonsGrant, router as hermes_connectors_router
from .hermes_skills import apply_learning_setting, router as hermes_skills_router
from .chat_ui import router as chat_ui_router
from .model_speed import router as model_speed_router
from .student_memory import router as student_memory_router
from .outlook.router import router as outlook_router
from .outlook.sync import sync_loop as outlook_sync_loop
from .suggestions import router as suggestions_router
from .teams import router as teams_router
from .teams.seed import seed_teammate_roadmaps, seed_teams
from .schemas import AcceptInput, ProgressUpdate, ChatInput, ChatMessageUi, EvidenceDecision, EvidenceSubmit, FactCreate, FinalizeInput, GenerateInput, OpportunityIds, ProfileUpdate, ProposalCreate, QuizGenerateInput, ResetInput, RewindInput, RoadmapPlan, RoadmapSnapshot, SlidesExtendInput, SlidesExportInput, SlidesSuggestInput, SourceCreate, StageGenerateInput, StudentCreate, validate_generated
from .sources import SourceError, jobs as source_jobs, normalize_value, store_evidence
from .pipeline.evidence_step import prepare_upload
from .sources.pdf_text import MAX_UPLOAD_BYTES
from .quiz import QuizRunError, run_quiz
from .slides import SlidesRunError, build_full_deck_pptx, decode_image_list, decode_original_pptx, run_extend, run_suggest
from .transcribe import MAX_AUDIO_BYTES, TranscribeError, transcribe_audio


logger = logging.getLogger(__name__)
STARTED_AT = time.time()
OPPORTUNITY_SYNC_ENABLED = os.getenv("OPPORTUNITY_SYNC_ENABLED", "false").lower() in {"1", "true", "yes"}
OPPORTUNITY_SYNC_SECONDS = 30 * 60
_opportunity_sync_task: asyncio.Task | None = None
_outlook_sync_task: asyncio.Task | None = None
_blackboard_sync_task: asyncio.Task | None = None


DEMO_STUDENT_ID = "demo-student"
ROADMAP_SEED_PATH = Path(__file__).resolve().parents[1] / "seed-roadmap.json"
Db = Annotated[Session, Depends(get_db)]
app = FastAPI(title="Waypoint Hermes Backbone", version="0.1.0")
def _collaboration_identity(request: Request) -> tuple[str, str]:
    """Who the shared account belongs to on this computer: the same local student every other local route trusts."""
    from .identity import current_user as _local_user
    with SessionLocal() as db:
        user = _local_user(request, db, request.headers.get("x-waypoint-user"))
        return user.id, user.display_name


_collaboration_auth = collaboration_auth_router(identity=_collaboration_identity)
app.include_router(_collaboration_auth)
collab_coach.bind(_collaboration_auth)
app.include_router(collab_coach.router)
app.include_router(projects_router)
app.include_router(identity_router)
app.include_router(outlook_router)
app.include_router(teams_router)
app.include_router(blackboard_router)
app.include_router(blackboard_sync_router)
app.include_router(coop_router)
app.include_router(coop_refresh_router)
app.include_router(cv_router)
app.include_router(learning_updates_router)
app.include_router(suggestions_router)
app.include_router(connections_router)
app.include_router(hermes_skills_router)
app.include_router(student_memory_router)
app.include_router(chat_ui_router)
app.include_router(model_speed_router)
app.include_router(hermes_connectors_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def default_roadmap_snapshot() -> RoadmapSnapshot:
    return RoadmapSnapshot.model_validate_json(ROADMAP_SEED_PATH.read_text(encoding="utf-8"))


def active_roadmap(db: Session, student_id: str) -> RoadmapVersion:
    item = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    if item is None:
        raise HTTPException(404, "No active roadmap")
    return item


def proposal_dict(item: RoadmapProposal) -> dict:
    return {
        "id": item.id,
        "student_id": item.student_id,
        "base_version_id": item.base_version_id,
        "summary": item.summary,
        "reasoning": item.reasoning,
        "operations": json.loads(item.operations_json),
        "kind": item.kind,
        "snapshot": json.loads(item.snapshot_json) if item.snapshot_json else None,
        "status": item.status,
        "created_at": item.created_at.isoformat(),
    }


def require_student(db: Session, student_id: str) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    return student


def profile_dict(student: Student, profile: StudentProfile | None) -> dict:
    # Students created before onboarding existed (the demo) count as onboarded.
    return {
        "student_id": student.id,
        "display_name": student.display_name,
        "institution": profile.institution if profile else "",
        "program": profile.program if profile else "",
        "discipline": profile.discipline if profile else "other",
        "year_label": profile.year_label if profile else "",
        "grad_target": profile.grad_target if profile else "",
        "onboarding_status": profile.onboarding_status if profile else "done",
    }


def source_dict(item: DataSource) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "label": item.label,
        "config": json.loads(item.config_json),
        "status": item.status,
        "error": item.error,
        "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
        **source_jobs.snapshot(item.id),
    }


def evidence_dict(item: EvidenceItem) -> dict:
    return {
        "id": item.id,
        "source_id": item.source_id,
        "kind": item.kind,
        "title": item.title,
        "data": json.loads(item.data_json),
        "source_ref": item.source_ref,
        "status": item.status,
    }


def owned_thread(db: Session, thread_id: str, user: User) -> ChatThread:
    thread = db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(404, "Thread not found")
    assert_owner(user, thread.student_id)
    return thread


def owned_run(db: Session, run_id: str, user: User) -> AgentRun:
    run = db.get(AgentRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    owned_thread(db, run.thread_id, user)
    return run


def owned_proposal(db: Session, proposal_id: str, user: User) -> RoadmapProposal:
    item = db.get(RoadmapProposal, proposal_id)
    if item is None:
        raise HTTPException(404, "Proposal not found")
    assert_owner(user, item.student_id)
    return item


def _regenerating(profile: StudentProfile | None) -> bool:
    """True while a student who finished onboarding is generating a replacement roadmap."""
    return profile is not None and profile.onboarding_status == "done"


def _store_initial_proposal(db: Session, student_id: str, base_id: str, snapshot: RoadmapSnapshot) -> dict:
    """Persist a generated first roadmap as a pending `initial` proposal."""
    for stale in db.scalars(select(RoadmapProposal).where(RoadmapProposal.student_id == student_id, RoadmapProposal.kind == "initial", RoadmapProposal.status == "pending")).all():
        stale.status = "rejected"
        stale.decided_at = now()
    proposal = RoadmapProposal(
        student_id=student_id, base_version_id=base_id, kind="initial",
        summary=f"First roadmap: {snapshot.title}"[:240],
        reasoning="Generated from your confirmed evidence and onboarding answers.",
        operations_json="[]", snapshot_json=snapshot.model_dump_json(),
    )
    db.add(proposal)
    saved_profile = db.get(StudentProfile, student_id)
    # A student who already finished onboarding and archived a roadmap stays in the app.
    if saved_profile is not None and not _regenerating(saved_profile):
        saved_profile.onboarding_status = "preview"
    db.commit()
    return proposal_dict(proposal)


@app.on_event("startup")
async def startup() -> None:
    Base.metadata.create_all(engine)
    ensure_added_columns()
    ensure_indexes()
    db = SessionLocal()
    try:
        # Generation runs live in memory; after a restart none exist, so nobody can still be "generating".
        for stuck in db.scalars(select(StudentProfile).where(StudentProfile.onboarding_status == "generating")).all():
            stuck.onboarding_status = "chat"
        db.commit()
        if db.get(Student, DEMO_STUDENT_ID) is None:
            db.add(Student(id=DEMO_STUDENT_ID, display_name="Demo Student"))
            db.flush()
        if db.scalar(select(func.count()).select_from(RoadmapVersion).where(RoadmapVersion.student_id == DEMO_STUDENT_ID)) == 0:
            db.add(RoadmapVersion(student_id=DEMO_STUDENT_ID, version=1, snapshot_json=default_roadmap_snapshot().model_dump_json(), active=True))
        if db.scalar(select(func.count()).select_from(ChatThread).where(ChatThread.student_id == DEMO_STUDENT_ID)) == 0:
            db.add(ChatThread(student_id=DEMO_STUDENT_ID, title="My Hermes Coach"))
        db.commit()
        seed_demo_snapshot(db)
        seed_teams(db)
        seed_teammate_roadmaps(db)
        seed_coop_catalog(db)
        reset_blackboard_syncs(db)
    finally:
        db.close()
    try:
        # Provisioning re-copies config.yaml on every launch; re-apply Settings > Skills to it.
        apply_learning_setting()
    except OSError:
        logger.warning("Could not apply the skill-learning setting to the Hermes runtime config", exc_info=True)
    global _opportunity_sync_task
    global _outlook_sync_task
    start_learning_scheduler()
    start_coop_scheduler()  # co-op refresh runs from app start, independent of the hackathon sync
    if os.getenv("OUTLOOK_SYNC_ENABLED", "false").lower() == "true" and (_outlook_sync_task is None or _outlook_sync_task.done()):
        _outlook_sync_task = asyncio.create_task(outlook_sync_loop())
    if OPPORTUNITY_SYNC_ENABLED and (_opportunity_sync_task is None or _opportunity_sync_task.done()):
        _opportunity_sync_task = asyncio.create_task(_opportunity_sync_loop())
    global _blackboard_sync_task
    if os.getenv("BLACKBOARD_SYNC_ENABLED", "true").lower() == "true" and (_blackboard_sync_task is None or _blackboard_sync_task.done()):
        _blackboard_sync_task = asyncio.create_task(blackboard_sync_loop())


def _sync_job(name: str, job, *args) -> None:
    """One sync on its own session: a failure in one source never poisons the next one's
    transaction, and the previous cache stays usable."""
    db = SessionLocal()
    try:
        job(db, *args)
    except OpportunitySourceError as exc:
        # The source was unreachable or answered badly (offline, DNS, timeout): expected, retried next cycle.
        db.rollback()
        logger.warning("Opportunity sync skipped: %s (%s)", name, exc)
    except Exception:
        db.rollback()
        logger.exception("Opportunity sync failed: %s", name)
    finally:
        db.close()


async def _opportunity_sync_loop() -> None:
    while True:
        await asyncio.to_thread(_sync_job, "hackathonat", sync_hackathonat)
        await asyncio.sleep(OPPORTUNITY_SYNC_SECONDS)


@app.on_event("shutdown")
async def shutdown() -> None:
    await stop_learning_scheduler()
    await stop_coop_scheduler()
    global _outlook_sync_task
    if _outlook_sync_task is not None:
        _outlook_sync_task.cancel()
        try:
            await _outlook_sync_task
        except asyncio.CancelledError:
            pass
        _outlook_sync_task = None
    global _blackboard_sync_task
    if _blackboard_sync_task is not None:
        _blackboard_sync_task.cancel()
        try:
            await _blackboard_sync_task
        except asyncio.CancelledError:
            pass
        _blackboard_sync_task = None
    global _opportunity_sync_task
    if _opportunity_sync_task is not None:
        _opportunity_sync_task.cancel()
        try:
            await _opportunity_sync_task
        except asyncio.CancelledError:
            pass
        _opportunity_sync_task = None


@app.get("/api/health")
def health() -> dict:
    try:
        response = httpx.get(
            f"{HERMES_URL}/health/detailed",
            headers={"Authorization": f"Bearer {HERMES_API_KEY}"},
            timeout=2,
        )
        response.raise_for_status()
        payload = response.json()
        agent = _hermes_agent_status(payload)
    except Exception:
        agent = "unavailable"
    db = SessionLocal()
    try: decisions = decision_status(db)
    finally: db.close()
    provider, model = saved_choice()
    return {"status": "ok", "database": "ready", "agent": agent, "decisions": decisions, "started_at": STARTED_AT, "model": model, "provider": provider}


@app.get("/api/decisions/status")
def decisions_status(db: Db) -> dict:
    return decision_status(db)


@app.get("/api/decisions/recent")
def recent_decisions(db: Db, limit: int = 20) -> dict:
    rows = db.scalars(select(DecisionRecord).order_by(DecisionRecord.created_at.desc()).limit(max(1, min(limit, 100)))).all()
    return {"decisions": [{
        "id": row.id, "purpose": row.purpose, "entity_type": row.entity_type, "entity_id": row.entity_id,
        "model": row.model, "mode": row.mode, "status": row.status, "answers": json.loads(row.answers_json),
        "latency_ms": row.latency_ms, "input_tokens": row.input_tokens, "output_tokens": row.output_tokens,
        "error_category": row.error_category, "created_at": row.created_at.isoformat(),
    } for row in rows]}


def _hermes_agent_status(payload: dict) -> str:
    """Map the Hermes gateway detailed health to ready/degraded.

    The gateway reports top-level ``degraded`` for non-fatal issues such as
    a full disk while it can still run (``gateway_state == "running"`` with
    ``model`` and ``gateway`` checks ok). Treat that as ready so the UI does
    not claim the agent is down while chat works.
    """
    status = payload.get("status") if isinstance(payload, dict) else None
    if status in {"ok", "ready"}:
        return "ready"
    if isinstance(payload, dict) and payload.get("gateway_state") == "running":
        readiness = payload.get("readiness")
        checks = readiness.get("checks") if isinstance(readiness, dict) else None
        if not isinstance(checks, dict):
            return "ready"
        critical = []
        for name in ("model", "gateway"):
            check = checks.get(name)
            critical.append(check.get("status") if isinstance(check, dict) else None)
        if all(item in {"ok", None} for item in critical):
            return "ready"
    return "degraded"


@app.get("/api/demo")
def demo(db: Db) -> dict:
    thread = db.scalar(select(ChatThread).where(ChatThread.student_id == DEMO_STUDENT_ID).order_by(ChatThread.created_at))
    return {"student_id": DEMO_STUDENT_ID, "thread_id": thread.id}


@app.post("/api/demo/reset")
def reset_demo(_body: ResetInput, db: Db) -> dict:
    student = db.get(Student, DEMO_STUDENT_ID)
    if student is None:
        raise HTTPException(404, "Student not found")

    active_run_count = db.scalar(
        select(func.count())
        .select_from(AgentRun)
        .join(ChatThread, AgentRun.thread_id == ChatThread.id)
        .where(ChatThread.student_id == DEMO_STUDENT_ID, AgentRun.status.notin_(["completed", "failed", "cancelled"]))
    )
    if active_run_count:
        raise HTTPException(409, "Hermes is still working; wait for it to finish before resetting")

    snapshot = default_roadmap_snapshot()
    thread_ids = db.scalars(select(ChatThread.id).where(ChatThread.student_id == DEMO_STUDENT_ID)).all()
    if thread_ids:
        db.execute(delete(AgentRun).where(AgentRun.thread_id.in_(thread_ids)))
        db.execute(delete(ChatMessage).where(ChatMessage.thread_id.in_(thread_ids)))
    db.execute(delete(RoadmapProposal).where(RoadmapProposal.student_id == DEMO_STUDENT_ID))
    db.execute(delete(StudentOpportunity).where(StudentOpportunity.student_id == DEMO_STUDENT_ID))
    db.execute(delete(StudentFact).where(StudentFact.student_id == DEMO_STUDENT_ID))
    db.execute(delete(StudentMemory).where(StudentMemory.student_id == DEMO_STUDENT_ID))
    db.execute(delete(StudentHermesSettings).where(StudentHermesSettings.student_id == DEMO_STUDENT_ID))
    db.execute(delete(EvidenceItem).where(EvidenceItem.student_id == DEMO_STUDENT_ID))
    db.execute(delete(DataSource).where(DataSource.student_id == DEMO_STUDENT_ID))
    db.execute(delete(ChatThread).where(ChatThread.student_id == DEMO_STUDENT_ID))
    db.execute(delete(RoadmapVersion).where(RoadmapVersion.student_id == DEMO_STUDENT_ID))

    version = RoadmapVersion(student_id=DEMO_STUDENT_ID, version=1, snapshot_json=snapshot.model_dump_json(), active=True)
    thread = ChatThread(student_id=DEMO_STUDENT_ID, title="My Hermes Coach", hermes_session_id=uid())
    db.add_all([version, thread])
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"status": "reset", "student_id": DEMO_STUDENT_ID, "thread_id": thread.id, "version_id": version.id, "version": 1}


EMPTY_ROADMAP = RoadmapSnapshot(title="Your roadmap", stages=[], nodes=[])


@app.post("/api/students", status_code=201)
def create_student(body: StudentCreate, db: Db) -> dict:
    """Lightweight sign-up: a student record with an empty v0 roadmap.

    There is no password or auth yet (see docs/future-work.md); the browser
    remembers the returned id. v0 exists so generated roadmaps are still
    proposals against a base version.
    """
    student = Student(display_name=body.display_name.strip())
    db.add(student)
    db.flush()
    db.add_all([
        StudentProfile(student_id=student.id),
        RoadmapVersion(student_id=student.id, version=0, snapshot_json=EMPTY_ROADMAP.model_dump_json(), reason="Awaiting onboarding", active=True),
        ChatThread(student_id=student.id, title="My Hermes Coach"),
    ])
    # The identity row exists from the start, so the app's first parallel requests never race to create it.
    db.add(User(id=student.id, display_name=student.display_name, role="student", student_id=student.id))
    db.flush()
    recompute_student(db, student.id)
    db.commit()
    return {**profile_dict(student, db.get(StudentProfile, student.id)), "thread_id": first_thread(db, student.id).id}


@app.get("/api/students")
def list_students(db: Db) -> list[dict]:
    """Profiles created on this machine, so the welcome page can resume one after a switch.

    Seeded demo classmates (`demo-*`) are left out; the demo student has its own button.
    There is no auth yet (see docs/future-work.md): anyone using this Waypoint can pick any profile.
    """
    rows = db.execute(
        select(Student, StudentProfile)
        .join(StudentProfile, StudentProfile.student_id == Student.id)
        .where(Student.id.not_like("demo-%"))
        .order_by(Student.created_at.desc())
    ).all()
    return [
        {"student_id": student.id, "display_name": student.display_name, "onboarding_status": profile.onboarding_status,
         "created_at": student.created_at.isoformat() if student.created_at else None}
        for student, profile in rows
    ]


def first_thread(db: Session, student_id: str) -> ChatThread:
    thread = db.scalar(select(ChatThread).where(ChatThread.student_id == student_id).order_by(ChatThread.created_at))
    if thread is None:
        raise HTTPException(404, "Student has no chat thread")
    return thread


@app.get("/api/disciplines")
def disciplines() -> list[dict]:
    return public_registry()


@app.get("/api/students/{student_id}/profile")
def get_profile(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    student = require_student(db, student_id)
    return {**profile_dict(student, db.get(StudentProfile, student_id)), "thread_id": first_thread(db, student_id).id}


@app.put("/api/students/{student_id}/profile")
def update_profile(student_id: str, _owner: OwnedStudent, body: ProfileUpdate, db: Db) -> dict:
    student = require_student(db, student_id)
    profile = db.get(StudentProfile, student_id)
    if profile is None:
        profile = StudentProfile(student_id=student_id)
        db.add(profile)
    changes = body.model_dump(exclude_none=True)
    if changes.get("onboarding_status") not in (None, "generating") and generation_runs.live(student_id) is not None:
        # Moving the student back a step would orphan the run; they can stop it first.
        raise HTTPException(409, "Your roadmap is still being built. Stop it first to change your answers.")
    for key, value in changes.items():
        setattr(profile, key, value.strip() if isinstance(value, str) else value)
    if "program" in changes and "discipline" not in changes:
        profile.discipline = classify_program(profile.program)
    db.flush()
    recompute_student(db, student_id)
    db.commit()
    return {**profile_dict(student, profile), "thread_id": first_thread(db, student_id).id}


@app.get("/api/students/{student_id}/opportunities/summary")
def get_opportunity_summary(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    require_student(db, student_id)
    return opportunity_summary(db, student_id)


@app.post("/api/students/{student_id}/opportunities/mark-seen")
def mark_opportunities_seen(student_id: str, _owner: OwnedStudent, body: OpportunityIds, db: Db) -> dict:
    require_student(db, student_id)
    return {"updated": mark_seen(db, student_id, body.ids)}


@app.post("/api/students/{student_id}/opportunities/{opportunity_id}/dismiss")
def dismiss_opportunity(student_id: str, _owner: OwnedStudent, opportunity_id: str, db: Db) -> dict:
    require_student(db, student_id)
    item = db.scalar(select(StudentOpportunity).where(StudentOpportunity.student_id == student_id, StudentOpportunity.opportunity_id == opportunity_id))
    if item is None:
        raise HTTPException(404, "Opportunity recommendation not found")
    item.status = "dismissed"
    item.seen_at = now()
    db.commit()
    return {"status": "dismissed"}


@app.get("/api/students/{student_id}/sources")
def list_sources(student_id: str, _owner: OwnedStudent, db: Db) -> list[dict]:
    require_student(db, student_id)
    items = db.scalars(select(DataSource).where(DataSource.student_id == student_id).order_by(DataSource.created_at)).all()
    # A source SQLite calls "syncing" with no live job was cut off by a restart: report it as
    # failed (retryable) instead of showing a spinner forever.
    stale = [item for item in items if item.status == "syncing" and not source_jobs.is_active(item.id)]
    for item in stale:
        mark_synced(item, "Reading was interrupted (the server restarted). Try again.")
    if stale:
        db.commit()
    return [source_dict(item) for item in items]


@app.post("/api/students/{student_id}/sources", status_code=201)
def add_source(student_id: str, _owner: OwnedStudent, body: SourceCreate, db: Db) -> dict:
    require_student(db, student_id)
    try:
        config = normalize_value(body.kind, body.value)
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    if body.kind == "folder":
        config["purpose"] = body.purpose or "projects"
    label = next(iter(config.values()), body.kind) if config else body.kind
    item = DataSource(student_id=student_id, kind=body.kind, label=str(label)[:200], config_json=json.dumps(config))
    db.add(item)
    db.commit()
    return source_dict(item)


@app.delete("/api/students/{student_id}/sources/{source_id}")
def delete_source(student_id: str, _owner: OwnedStudent, source_id: str, db: Db) -> dict:
    item = db.get(DataSource, source_id)
    if item is None or item.student_id != student_id:
        raise HTTPException(404, "Source not found")
    # Unconfirmed evidence goes with its source; confirmed evidence is the student's own record.
    db.execute(delete(EvidenceItem).where(EvidenceItem.source_id == source_id, EvidenceItem.status != "confirmed"))
    remaining = db.scalar(select(func.count()).select_from(EvidenceItem).where(EvidenceItem.source_id == source_id))
    if remaining:
        item.status = "removed"
    else:
        db.delete(item)
    db.commit()
    return {"status": "deleted"}


def _hermes_opts(provider: str | None, model: str | None, key: str | None) -> dict:
    return {"provider": provider, "model": model, "key": key}


def _run_source_job(source_id: str, job) -> dict:
    """Run one sync in a worker thread with its own session; record success or failure."""
    db = SessionLocal()
    source_jobs.begin(source_id, "reading")
    try:
        source = db.get(DataSource, source_id)
        if source is None:
            raise SourceError("Source not found", status=404)
        source.status = "syncing"
        db.commit()
        try:
            added = job(db, source)
        except Exception as exc:
            # Any failure (not only SourceError) must leave the source failed, never "syncing" forever.
            db.rollback()
            source = db.get(DataSource, source_id)
            message = str(exc) if isinstance(exc, SourceError) else "Reading this source failed unexpectedly; try again"
            if source is not None:
                mark_synced(source, message)
                db.commit()
            if isinstance(exc, SourceError):
                raise
            logger.exception("Source sync failed for %s", source_id)
            raise SourceError(message, status=502) from exc
        mark_synced(source)
        db.commit()
        return {**source_dict(source), "added": added}
    finally:
        source_jobs.finish(source_id)
        db.close()


def _start_background_job(db, source: DataSource, job) -> dict:
    """Mark the source queued and run the slow part on a worker thread; the browser polls /sources.

    Used with ?background=true so a slow model never holds an HTTP request open. Failures are
    recorded on the source (status failed + reason), exactly as in the synchronous path.
    """
    if source_jobs.is_active(source.id):
        raise HTTPException(409, "This source is already being read")
    source_jobs.begin(source.id, "queued")
    source.status = "syncing"
    source.error = None
    db.commit()

    def runner() -> None:
        try:
            _run_source_job(source.id, job)
        except SourceError:
            pass  # recorded on the source by _run_source_job
        except Exception:  # pragma: no cover - defensive; _run_source_job already records failures
            logger.exception("Background source job crashed for %s", source.id)

    threading.Thread(target=runner, name=f"source-{source.id[:8]}", daemon=True).start()
    return {**source_dict(source), "added": 0}


@app.post("/api/students/{student_id}/sources/{source_id}/upload")
async def upload_source(
    student_id: str,
    _owner: OwnedStudent,
    source_id: str,
    db: Db,
    file: UploadFile = File(...),
    provider: str | None = Form(default=None),
    model: str | None = Form(default=None),
    background: bool = False,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Read an uploaded transcript/CV/LinkedIn file into suggested evidence.

    The file itself is never stored; only the extracted, redacted evidence is.
    """
    provider = model = None  # older tabs still send these; the model is the Settings choice
    source = db.get(DataSource, source_id)
    if source is None or source.student_id != student_id:
        raise HTTPException(404, "Source not found")
    if source.kind not in UPLOAD_KINDS:
        raise HTTPException(422, "This source is not a file upload")
    # LinkedIn exports are ZIPs of many CSVs, so they get a larger cap (see sources/linkedin_zip.py).
    limit = MAX_UPLOAD_BYTES * 3 if source.kind == "linkedin_zip" else MAX_UPLOAD_BYTES
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Files must be {limit // (1024 * 1024)} MB or smaller")
    hermes = _hermes_opts(provider or None, model or None, x_hermes_api_key)
    try:
        if background:
            # Wrong, scanned or oversized files fail here, instantly; only the model call is deferred.
            try:
                job = await asyncio.to_thread(prepare_upload, source, data, file.filename or "", hermes)
            except SourceError as exc:
                mark_synced(source, str(exc))
                db.commit()
                raise
            return _start_background_job(db, source, job)
        return await asyncio.to_thread(_run_source_job, source_id, lambda session, src: sync_upload(session, src, data, file.filename or "", hermes))
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/students/{student_id}/sources/{source_id}/sync")
async def sync_source(
    student_id: str,
    _owner: OwnedStudent,
    source_id: str,
    db: Db,
    body: GenerateInput = Body(default_factory=GenerateInput),
    background: bool = False,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    source = db.get(DataSource, source_id)
    if source is None or source.student_id != student_id:
        raise HTTPException(404, "Source not found")
    if source.kind in UPLOAD_KINDS:
        raise HTTPException(422, "Upload a file for this source")
    hermes = _hermes_opts(body.provider, body.model, x_hermes_api_key)
    if background:
        return _start_background_job(db, source, lambda session, src: sync_remote(session, src, hermes))
    try:
        return await asyncio.to_thread(_run_source_job, source_id, lambda session, src: sync_remote(session, src, hermes))
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.get("/api/students/{student_id}/evidence")
def list_evidence(student_id: str, _owner: OwnedStudent, db: Db) -> list[dict]:
    require_student(db, student_id)
    items = db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student_id, EvidenceItem.status != "dismissed").order_by(EvidenceItem.kind, EvidenceItem.created_at)).all()
    return [evidence_dict(item) for item in items]


@app.post("/api/students/{student_id}/evidence/decide")
def decide_evidence(student_id: str, _owner: OwnedStudent, body: EvidenceDecision, db: Db) -> dict:
    """The student's explicit review: confirmed evidence becomes StudentFacts.

    Ticking an item is an explicit statement by the student, so it is the one
    non-chat path into StudentFact (source_kind="confirmed_evidence").
    """
    require_student(db, student_id)
    return decide_evidence_step(db, student_id, list(body.confirm), list(body.dismiss), dict(body.titles))


@app.post("/api/students/{student_id}/onboarding/generate")
async def generate_roadmap(
    student_id: str,
    _owner: OwnedStudent,
    db: Db,
    body: GenerateInput = Body(default_factory=GenerateInput),
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Ask Hermes for a whole first roadmap and store it as an `initial` proposal.

    Only the accept endpoint activates it. Allowed while the active roadmap is
    still the empty v0.
    """
    current = _require_empty_roadmap(db, student_id)
    _require_ready(db, student_id)
    profile = db.get(StudentProfile, student_id)
    base_id = current.id
    hermes = _hermes_opts(body.provider, body.model, x_hermes_api_key)

    def job() -> dict:
        session = SessionLocal()
        try:
            snapshot = generate_initial_roadmap(session, student_id, hermes)
            return _store_initial_proposal(session, student_id, base_id, snapshot)
        finally:
            session.close()

    # Only first-time onboarding moves through the generating/preview states; a student who is
    # replacing an archived roadmap stays "done" so the app never throws them back into onboarding.
    first_time = not _regenerating(profile)
    if profile is not None and first_time:
        profile.onboarding_status = "generating"
        db.commit()
    try:
        return await asyncio.to_thread(job)
    except Exception as exc:
        if profile is not None and first_time:
            profile.onboarding_status = "chat"
            db.commit()
        if isinstance(exc, HermesJsonError):
            raise HTTPException(exc.status, str(exc)) from exc
        raise


@app.get("/api/students/{student_id}/onboarding/readiness")
def onboarding_readiness(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    """Readiness gate: is the background collection complete enough to generate?"""
    require_student(db, student_id)
    return readiness_for(db, student_id)


def _require_empty_roadmap(db: Session, student_id: str):
    current = active_roadmap(db, student_id)
    if RoadmapSnapshot.model_validate_json(current.snapshot_json).nodes:
        raise HTTPException(409, "This student already has a roadmap; ask Hermes Coach to revise it instead")
    return current


def _require_ready(db: Session, student_id: str) -> None:
    """The readiness gate is a server rule, not just a disabled button."""
    state = readiness_for(db, student_id)
    if not state["ready"]:
        raise HTTPException(409, "; ".join(state["blockers"]))


@app.post("/api/students/{student_id}/onboarding/roadmap/plan")
async def plan_staged_roadmap(
    student_id: str,
    _owner: OwnedStudent,
    db: Db,
    body: GenerateInput = Body(default_factory=GenerateInput),
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Step 0 of staged generation: plan stage titles + shapes, no nodes yet.

    Returns a job_id used by the per-stage endpoints. The plan fixes stage
    IDs upfront so later wiring checks can enforce backwards-only deps.
    """
    current = _require_empty_roadmap(db, student_id)
    _require_ready(db, student_id)
    hermes = _hermes_opts(body.provider, body.model, x_hermes_api_key)
    brief = build_profile_brief(db, student_id)
    base_id = current.id
    try:
        plan = await asyncio.to_thread(roadmap_planner.generate_plan, brief, hermes)
    except HermesJsonError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    job_id = staged_store.create_job(student_id, base_id, brief, plan, hermes)
    return {"job_id": job_id, "plan": plan.model_dump()}


@app.post("/api/students/{student_id}/onboarding/roadmap/stages/{stage_id}/generate")
async def generate_roadmap_stage(
    student_id: str,
    _owner: OwnedStudent,
    stage_id: str,
    db: Db,
    body: StageGenerateInput = Body(...),
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Generate exactly one planned stage. Safe to call for two stages in
    parallel: generation is stateless and only the append is serialized."""
    require_student(db, student_id)
    _require_empty_roadmap(db, student_id)
    job = staged_store.get_job(body.job_id)
    if job is None or job["student_id"] != student_id:
        raise HTTPException(404, "Generation job not found")
    if job["base_version_id"] != active_roadmap(db, student_id).id:
        raise HTTPException(409, "The roadmap changed since planning; plan again")
    plan: RoadmapPlan = job["plan"]
    if stage_id not in [item.id for item in plan.stages]:
        raise HTTPException(404, "Stage not in this plan")
    hermes = {
        "provider": body.provider or job["hermes"].get("provider"),
        "model": body.model or job["hermes"].get("model"),
        "key": x_hermes_api_key or job["hermes"].get("key"),
    }
    prior, used = staged_store.prior_node_summaries(job, stage_id)
    try:
        nodes = await asyncio.to_thread(
            roadmap_stage.generate_stage_nodes,
            job["brief"], plan, stage_id, prior, used, job["confirmed"], hermes,
        )
    except HermesJsonError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    merged = {**job["completed"], stage_id: nodes}
    wiring_error = roadmap_stitch.check_wiring(plan, merged)
    if wiring_error:
        raise HTTPException(422, wiring_error)
    try:
        staged_store.append_stage(body.job_id, stage_id, nodes)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(409, "This generation job was finished or expired; plan again") from exc
    finished = staged_store.get_job(body.job_id)
    if finished is None:
        raise HTTPException(409, "This generation job was finished or expired; plan again")
    snapshot = roadmap_stitch.merge_stages(plan.title, plan, finished["completed"])
    return {
        "job_id": body.job_id,
        "stage_id": stage_id,
        "nodes": [node.model_dump() for node in nodes],
        "snapshot": snapshot.model_dump(),
    }


@app.post("/api/students/{student_id}/onboarding/roadmap/finalize")
def finalize_staged_roadmap(student_id: str, _owner: OwnedStudent, body: FinalizeInput, db: Db) -> dict:
    """Validate the stitched stages and store the `initial` proposal."""
    require_student(db, student_id)
    current = _require_empty_roadmap(db, student_id)
    job = staged_store.get_job(body.job_id)
    if job is None or job["student_id"] != student_id:
        raise HTTPException(404, "Generation job not found")
    if job["base_version_id"] != current.id:
        raise HTTPException(409, "The roadmap changed since planning; plan again")
    plan: RoadmapPlan = job["plan"]
    missing = [item.id for item in plan.stages if item.id not in job["completed"]]
    if missing:
        raise HTTPException(409, f"Stage(s) not generated yet: {', '.join(missing)}")
    wiring_error = roadmap_stitch.check_wiring(plan, job["completed"])
    if wiring_error:
        raise HTTPException(422, wiring_error)
    snapshot = roadmap_stitch.merge_stages(plan.title, plan, job["completed"])
    try:
        finished = validate_generated(snapshot, job["confirmed"])
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    proposal = _store_initial_proposal(db, student_id, job["base_version_id"], finished)
    staged_store.drop_job(body.job_id)
    return proposal


def _sse(name: str, payload: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(payload)}\n\n"


async def _run_generation(run: generation_runs.GenerationRun, hermes: dict) -> None:
    """Generate the first roadmap stage by stage into `run`'s event log.

    This is a server-side task, not part of any request: closing the page or navigating away does not
    stop it. It ends in exactly one of done / error / cancelled, and the student is never left in
    `generating` unless it finished."""
    student_id = run.student_id

    def prepare() -> tuple[str, dict]:
        db = SessionLocal()
        try:
            current = _require_empty_roadmap(db, student_id)
            _require_ready(db, student_id)
            brief = build_profile_brief(db, student_id)
            profile = db.get(StudentProfile, student_id)
            if profile is not None and not _regenerating(profile):
                profile.onboarding_status = "generating"
                db.commit()
            return current.id, brief
        finally:
            db.close()

    def finish(base_id: str, snapshot: RoadmapSnapshot) -> dict:
        db = SessionLocal()
        try:
            return _store_initial_proposal(db, student_id, base_id, snapshot)
        finally:
            db.close()

    job_id: str | None = None
    done = False
    try:
        try:
            base_id, brief = await asyncio.to_thread(prepare)
        except HTTPException as exc:
            await run.publish("error", {"error": exc.detail})
            return
        plan = await asyncio.to_thread(roadmap_planner.generate_plan, brief, hermes)
        job_id = staged_store.create_job(student_id, base_id, brief, plan, hermes)
        await run.publish("plan", {"job_id": job_id, "plan": plan.model_dump()})
        for item in plan.stages:
            job = staged_store.get_job(job_id)
            if job is None:
                raise RuntimeError("This generation job expired; try again")
            prior, used = staged_store.prior_node_summaries(job, item.id)
            try:
                nodes = await asyncio.to_thread(
                    roadmap_stage.generate_stage_nodes,
                    brief, plan, item.id, prior, used, job["confirmed"], hermes,
                )
            except Exception as exc:
                await run.publish("error", {"error": str(exc), "stage_id": item.id})
                return
            wiring_error = roadmap_stitch.check_wiring(plan, {**job["completed"], item.id: nodes})
            if wiring_error:
                await run.publish("error", {"error": wiring_error, "stage_id": item.id})
                return
            staged_store.append_stage(job_id, item.id, nodes)
            snapshot = roadmap_stitch.merge_stages(plan.title, plan, staged_store.get_job(job_id)["completed"])
            await run.publish("stage", {"job_id": job_id, "stage_id": item.id, "nodes": [n.model_dump() for n in nodes], "snapshot": snapshot.model_dump()})
        job = staged_store.get_job(job_id)
        snapshot = roadmap_stitch.merge_stages(plan.title, plan, job["completed"])
        try:
            finished = validate_generated(snapshot, job["confirmed"])
        except ValueError as exc:
            await run.publish("error", {"error": str(exc)})
            return
        proposal = await asyncio.to_thread(finish, base_id, finished)
        done = True
        await run.publish("done", {"job_id": job_id, "proposal_id": proposal["id"]})
    except asyncio.CancelledError:
        await run.publish("cancelled", {})
        raise
    except Exception as exc:
        logger.exception("Staged roadmap generation failed")
        await run.publish("error", {"error": str(exc) or "Roadmap generation failed"})
    finally:
        if job_id is not None:
            staged_store.drop_job(job_id)
        if not done:
            await asyncio.to_thread(_reset_to_chat, student_id)
        # Every path above ends the log; this covers a failure that skipped them.
        await run.publish("error", {"error": "Roadmap generation stopped"})


@app.get("/api/students/{student_id}/onboarding/generate/stream")
async def generate_staged_stream(
    student_id: str,
    _owner: OwnedStudent,
    provider: str | None = None,
    model: str | None = None,
    attach: bool = False,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> StreamingResponse:
    """Staged generation as SSE: plan, then each finished stage with the snapshot so far, then done.

    Generation runs in the background (`_run_generation`), so this stream only watches it: the first
    call starts a run, later calls (a reload, a second tab) replay and follow the same one, and closing
    the stream does not stop it. `attach=true` never starts a run; it only follows one that exists."""
    hermes = _hermes_opts(provider, model, x_hermes_api_key)
    run = generation_runs.live(student_id)
    if run is None:
        previous = generation_runs.get(student_id)
        if attach and previous is not None:
            run = previous
        elif attach:
            _reset_to_chat(student_id)

            async def nothing_running():
                yield _sse("error", {"error": "No roadmap is being generated. Start again from the chat."})

            return StreamingResponse(nothing_running(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
        else:
            run = generation_runs.GenerationRun(student_id)
            generation_runs.register(run)
            run.task = asyncio.create_task(_run_generation(run, hermes))

    async def stream():
        async for name, payload in run.follow():
            yield _sse(name, payload)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/students/{student_id}/onboarding/generate/status")
def generation_status(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    """Cheap progress for the app shell, which polls this while the student explores."""
    require_student(db, student_id)
    run = generation_runs.get(student_id)
    return run.summary() if run is not None else {"state": "idle", "title": None, "total_stages": 0, "completed_stage_ids": [], "proposal_id": None, "error": None}


@app.post("/api/students/{student_id}/onboarding/generate/cancel")
async def cancel_generation(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    require_student(db, student_id)
    run = generation_runs.live(student_id)
    if run is not None and run.task is not None:
        run.task.cancel()
        # Wait for the task's cleanup so the student is back in `chat` when this returns.
        with contextlib.suppress(asyncio.CancelledError):
            await run.task
    return {"cancelled": run is not None}


def _reset_to_chat(student_id: str) -> None:
    db = SessionLocal()
    try:
        profile = db.get(StudentProfile, student_id)
        if profile is not None and profile.onboarding_status == "generating":
            profile.onboarding_status = "chat"
            db.commit()
    finally:
        db.close()


@app.get("/api/students/{student_id}/context")
def student_context(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    return _context_dict(db, require_student(db, student_id))


def _context_dict(db: Session, student: Student) -> dict:
    facts = db.scalars(select(StudentFact).where(StudentFact.student_id == student.id, StudentFact.active.is_(True)).order_by(StudentFact.created_at)).all()
    return {
        "id": student.id,
        "display_name": student.display_name,
        "facts": [
            {"id": fact.id, "category": fact.category, "key": fact.key, "value": json.loads(fact.value_json), "confidence": fact.confidence}
            for fact in facts
        ],
    }


@app.get("/api/students/{student_id}/roadmap")
def get_roadmap(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    return _roadmap_dict(db, student_id)


def _roadmap_dict(db: Session, student_id: str) -> dict:
    item = active_roadmap(db, student_id)
    return {"version_id": item.id, "version": item.version, "reason": item.reason, "snapshot": json.loads(item.snapshot_json)}


@app.put("/api/students/{student_id}/roadmap/nodes/{node_id}")
def update_progress(student_id: str, _owner: OwnedStudent, node_id: str, body: dict, db: Db) -> dict:
    status = body.get("status")
    if status not in {"not-started", "in-progress", "done"}:
        raise HTTPException(422, "Invalid status")
    item = active_roadmap(db, student_id)
    snapshot = RoadmapSnapshot.model_validate_json(item.snapshot_json)
    node = next((candidate for candidate in snapshot.nodes if candidate.id == node_id), None)
    if node is None:
        raise HTTPException(404, "Node not found")
    node.status = status
    item.snapshot_json = snapshot.model_dump_json()
    db.commit()
    return {"node_id": node_id, "status": status}


@app.put("/api/students/{student_id}/roadmap/progress")
def update_progress_bulk(student_id: str, _owner: OwnedStudent, body: ProgressUpdate, db: Db) -> dict:
    """Set many node statuses in one read-modify-write (Reset progress used to send one PUT per
    node, and the parallel writes overwrote each other)."""
    item = active_roadmap(db, student_id)
    snapshot = RoadmapSnapshot.model_validate_json(item.snapshot_json)
    known = {node.id: node for node in snapshot.nodes}
    missing = [node_id for node_id in body.statuses if node_id not in known]
    if missing:
        raise HTTPException(404, f"Unknown node(s): {', '.join(missing[:5])}")
    for node_id, status in body.statuses.items():
        known[node_id].status = status
    item.snapshot_json = snapshot.model_dump_json()
    db.commit()
    return {"updated": len(body.statuses)}


def _version_summary(item: RoadmapVersion) -> dict:
    # History lists every version ever saved, so read it leniently: one old snapshot must not break the list.
    try:
        snapshot = json.loads(item.snapshot_json)
    except json.JSONDecodeError:
        snapshot = {}
    nodes = [node for node in snapshot.get("nodes") or [] if isinstance(node, dict)]
    return {
        "id": item.id,
        "version": item.version,
        "reason": item.reason,
        "active": item.active,
        "created_at": item.created_at.isoformat(),
        "title": snapshot.get("title") or "",
        "nodes": len(nodes),
        "done": sum(1 for node in nodes if node.get("status") == "done"),
    }


def _owned_version(db: Session, student_id: str, version_id: str) -> RoadmapVersion:
    item = db.get(RoadmapVersion, version_id)
    if item is None or item.student_id != student_id:
        raise HTTPException(404, "Roadmap version not found")
    return item


def _replace_active_roadmap(db: Session, student_id: str, current: RoadmapVersion, snapshot: RoadmapSnapshot, reason: str) -> RoadmapVersion:
    """Retire the active version and append a new one; pending proposals were written against the old base."""
    retired = db.execute(
        update(RoadmapVersion).where(RoadmapVersion.id == current.id, RoadmapVersion.active.is_(True))
        .values(active=False).execution_options(synchronize_session=False)
    ).rowcount
    if not retired:
        db.rollback()
        raise HTTPException(409, "The roadmap changed; refresh and try again")
    for stale in db.scalars(select(RoadmapProposal).where(RoadmapProposal.student_id == student_id, RoadmapProposal.status == "pending")).all():
        stale.status = "rejected"
        stale.decided_at = now()
    latest = db.scalar(select(func.max(RoadmapVersion.version)).where(RoadmapVersion.student_id == student_id)) or 0
    version = RoadmapVersion(student_id=student_id, version=latest + 1, snapshot_json=snapshot.model_dump_json(), reason=reason, active=True)
    db.add(version)
    db.flush()
    # Opportunity matching is a side effect: a failure there must never block removing or restoring a roadmap.
    try:
        with db.begin_nested():
            recompute_student(db, student_id)
    except Exception:
        logger.exception("Opportunity recompute failed after a roadmap change for %s", student_id)
    try:
        db.commit()
    except (IntegrityError, OperationalError) as failure:
        db.rollback()
        logger.warning("Roadmap replace for %s failed at commit: %s", student_id, failure)
        raise HTTPException(409, "The roadmap is being changed somewhere else; refresh and try again") from None
    return version


@app.get("/api/students/{student_id}/roadmap/versions")
def list_roadmap_versions(student_id: str, _owner: OwnedStudent, db: Db) -> list[dict]:
    """History: every version the student has had, newest first. Old versions are never deleted."""
    items = db.scalars(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id).order_by(RoadmapVersion.version.desc())).all()
    return [_version_summary(item) for item in items]


@app.get("/api/students/{student_id}/roadmap/versions/{version_id}")
def get_roadmap_version(student_id: str, _owner: OwnedStudent, version_id: str, db: Db) -> dict:
    item = _owned_version(db, student_id, version_id)
    return {"version_id": item.id, "version": item.version, "reason": item.reason, "active": item.active, "snapshot": json.loads(item.snapshot_json)}


@app.post("/api/students/{student_id}/roadmap/archive")
def archive_roadmap(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    """The student removes their current roadmap. It stays in history; the active roadmap becomes
    empty, which is the one state a newly generated roadmap (a Hermes `initial` proposal) may
    replace, and it still takes an explicit accept."""
    current = active_roadmap(db, student_id)
    # Read the raw node list: an older snapshot that no longer passes today's graph checks must still be removable.
    try:
        has_nodes = bool(json.loads(current.snapshot_json).get("nodes"))
    except (json.JSONDecodeError, AttributeError):
        has_nodes = True
    if not has_nodes:
        raise HTTPException(409, "There is no roadmap to remove")
    version = _replace_active_roadmap(db, student_id, current, EMPTY_ROADMAP, f"Removed version {current.version}")
    return {"status": "archived", "version_id": version.id, "version": version.version}


@app.post("/api/students/{student_id}/roadmap/versions/{version_id}/restore")
def restore_roadmap_version(student_id: str, _owner: OwnedStudent, version_id: str, db: Db) -> dict:
    """The student brings an earlier roadmap back as a new version (history is never rewritten)."""
    old = _owned_version(db, student_id, version_id)
    snapshot = RoadmapSnapshot.model_validate_json(old.snapshot_json)
    if not snapshot.nodes:
        raise HTTPException(409, "That version is empty")
    current = active_roadmap(db, student_id)
    if current.id == old.id:
        raise HTTPException(409, "That version is already active")
    version = _replace_active_roadmap(db, student_id, current, snapshot, f"Restored version {old.version}")
    return {"status": "restored", "version_id": version.id, "version": version.version}


@app.get("/api/students/{student_id}/roadmap/proposals")
def list_proposals(student_id: str, _owner: OwnedStudent, db: Db) -> list[dict]:
    items = db.scalars(select(RoadmapProposal).where(RoadmapProposal.student_id == student_id).order_by(RoadmapProposal.created_at.desc())).all()
    return [proposal_dict(item) for item in items]


@app.get("/api/chat/threads/{thread_id}/messages")
def messages(thread_id: str, db: Db, user: CurrentUser) -> list[dict]:
    owned_thread(db, thread_id, user)
    items = db.scalars(select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.created_at)).all()
    return [{
        "id": item.id,
        "role": item.role,
        "content": item.content,
        "metadata": json.loads(item.metadata_json) if item.metadata_json else None,
        "agent_run_id": item.agent_run_id,
        "created_at": item.created_at.isoformat(),
    } for item in items]


@app.get("/api/chat/threads/{thread_id}/runs/latest")
def latest_run(thread_id: str, db: Db, user: CurrentUser) -> dict:
    """Most recent agent run for a thread, so a remounted client can resume
    watching a run that is still generating after navigation."""
    owned_thread(db, thread_id, user)
    run = db.scalar(select(AgentRun).where(AgentRun.thread_id == thread_id).order_by(AgentRun.created_at.desc(), AgentRun.id.desc()))
    if run is None:
        return {"run": None}
    return {"run": {
        "id": run.id,
        "status": run.status,
        "stage": run.stage,
        "error": run.error,
        "created_at": run.created_at.isoformat(),
    }}


def interaction_message(thread_id: str, body: ChatInput, db: Session) -> tuple[str, str]:
    """Validate a rendered control response and build canonical persisted text."""
    interaction = body.interaction
    assert interaction is not None
    source = db.get(ChatMessage, interaction.source_message_id)
    if source is None or source.thread_id != thread_id or source.role != "assistant":
        raise HTTPException(404, "Interaction source message not found in this thread")
    latest = db.scalar(select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc()))
    if latest is None or latest.id != source.id:
        raise HTTPException(409, "That interaction has already been answered or is no longer current")
    try:
        ui = ChatMessageUi.model_validate_json(source.metadata_json or "{}")
    except ValueError as exc:
        raise HTTPException(422, "The source message has no valid interaction controls") from exc

    selected_ids = list(dict.fromkeys(interaction.selected_option_ids))
    if len(selected_ids) != len(interaction.selected_option_ids):
        raise HTTPException(422, "Selected option IDs must be unique")

    if interaction.kind == "choice":
        group = ui.choice_group
        if group is None:
            raise HTTPException(422, "The source message has no choice group")
        available = {item.id: item for item in group.options}
        if any(item_id not in available for item_id in selected_ids):
            raise HTTPException(422, "Unknown choice option")
        if not group.min_selections <= len(selected_ids) <= group.max_selections:
            raise HTTPException(422, f"Select between {group.min_selections} and {group.max_selections} options")
        selected = [available[item_id] for item_id in selected_ids]
        titles = [item.title for item in selected]
        content = titles[0] if len(titles) == 1 else f"Selected: {', '.join(titles)}"
        details = "\n".join(
            f"- {item.title}: {item.description}"
            + (f" [Waypoint opportunity_id={item.opportunity_id}]" if item.opportunity_id else "")
            for item in selected
        )
        hermes_prompt = (
            "The student explicitly selected the following option(s) from your previous question:\n"
            f"{details}\nTreat this as their answer, and record the explicit preference when appropriate."
        )
    else:
        available = {item.id: item for item in ui.follow_ups}
        if len(selected_ids) != 1 or selected_ids[0] not in available:
            raise HTTPException(422, "Choose exactly one valid follow-up")
        selected = available[selected_ids[0]]
        content = selected.label
        hermes_prompt = selected.prompt

    metadata = {
        "interaction": {
            "kind": interaction.kind,
            "source_message_id": source.id,
            "selected_option_ids": selected_ids,
            "hermes_prompt": hermes_prompt,
        }
    }
    return content, json.dumps(metadata)


@app.post("/api/chat/threads/{thread_id}/messages", status_code=202)
def send_message(
    thread_id: str,
    body: ChatInput,
    request: Request,
    background: BackgroundTasks,
    db: Db,
    user: CurrentUser,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    thread = owned_thread(db, thread_id, user)
    if _live_run_count(db, thread_id):
        raise HTTPException(409, "Hermes is still answering; wait for it to finish or press Stop")
    try:
        resolve_hermes_selection(body.provider, body.model)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if body.interaction is not None:
        content, metadata_json = interaction_message(thread_id, body, db)
    else:
        content, metadata_json = body.content.strip(), None  # type: ignore[union-attr]
    message = ChatMessage(thread_id=thread_id, role="user", content=content, metadata_json=metadata_json)
    db.add(message)
    db.flush()
    run = AgentRun(thread_id=thread_id, user_message_id=message.id)
    db.add(run)
    db.flush()
    message.agent_run_id = run.id
    from .outlook.coach import issue_grant
    mailbox_access = issue_grant(request, db, run.id)
    collaboration_access = collab_coach.issue_grant(thread.student_id, run.id)
    db.commit()
    background.add_task(observe_independently, [DecisionItem(
        entity_type="chat_message", entity_id=message.id, title="Student coach request", text=content, student_id=thread.student_id,
    )], "chat_intent")
    background.add_task(run_agent, run.id, thread.student_id, body.provider, body.model, x_hermes_api_key, **({"mailbox_access": mailbox_access} if mailbox_access else {}), **({"collaboration_access": collaboration_access} if collaboration_access else {}))
    return {"run_id": run.id, "message_id": message.id, "status": run.status}


def _live_run_count(db: Session, thread_id: str) -> int:
    return db.scalar(select(func.count()).select_from(AgentRun).where(
        AgentRun.thread_id == thread_id, AgentRun.status.notin_(["completed", "failed", "cancelled"]),
    )) or 0


@app.post("/api/chat/threads/{thread_id}/rewind")
def rewind_thread(thread_id: str, body: RewindInput, db: Db, user: CurrentUser) -> dict:
    """Edit-and-resend: drop a user message and everything after it.

    The edited prompt is then sent as a fresh message, so the thread reads
    as if the old turn never happened instead of stacking a duplicate.
    Rejected while a run is still live (it would append onto the rewind).
    Gateway-side session memory is not rewound — only the stored history.
    """
    owned_thread(db, thread_id, user)
    if _live_run_count(db, thread_id):
        raise HTTPException(409, "Hermes is still answering — wait for it to finish before editing")
    items = db.scalars(select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.created_at, ChatMessage.id)).all()
    index = next((i for i, item in enumerate(items) if item.id == body.message_id), None)
    if index is None:
        raise HTTPException(404, "Message not found in this thread")
    if items[index].role != "user":
        raise HTTPException(422, "Only your own prompts can be edited and resent")
    for item in items[index:]:
        db.delete(item)
    db.commit()
    return {"status": "rewound", "deleted": len(items) - index}


@app.post("/api/quiz/generate")
async def generate_quiz(
    body: QuizGenerateInput,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Generate quiz source JSON through the Hermes gateway.

    Runs in a worker thread so the event loop stays free for chat streams.
    The gateway poll can take up to ~180s; the browser aborts via fetch signal.
    """
    try:
        return await asyncio.to_thread(
            run_quiz,
            body.source_text,
            body.count,
            body.difficulty,
            list(body.types),
            body.provider,
            body.model,
            x_hermes_api_key,
        )
    except QuizRunError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/slides/suggest")
async def suggest_slide_topics(
    body: SlidesSuggestInput,
    db: Db,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
    x_waypoint_user: Annotated[str | None, Header()] = None,
) -> dict:
    """Suggest extension topics for a deck through the Hermes gateway.

    Throwaway ``waypoint:slides:*`` session, no SQLite writes — same rule as
    quizzes: slide text is not an explicit student statement. When
    ``student_id`` is supplied, verified profile + active roadmap data are
    read from SQLite and injected server-side as prompt data; the model
    marks those topics ``source="roadmap"`` so the UI renders them
    identifiably differently from plain deck topics.
    """
    learner_context = ""
    if body.student_id:
        # Learner context is private: include it only for the caller's own record.
        caller = resolve_user(db, x_waypoint_user)
        student = db.get(Student, body.student_id.strip())
        if student is not None and caller is not None and caller.student_id == student.id:
            try:
                brief = build_profile_brief(db, student.id)
            except Exception:
                brief = {}
            try:
                item = active_roadmap(db, student.id)
                roadmap = {"version_id": item.id, "version": item.version, "reason": item.reason, "snapshot": json.loads(item.snapshot_json)}
            except Exception:
                roadmap = {}
            from .slides import build_learner_context_block

            learner_context = build_learner_context_block(brief, roadmap)
    try:
        return await asyncio.to_thread(
            run_suggest,
            body.source_text,
            body.count,
            body.provider,
            body.model,
            x_hermes_api_key,
            learner_context,
        )
    except SlidesRunError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/slides/extend")
async def extend_slides(
    body: SlidesExtendInput,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Generate new slides about a chosen (or custom) topic.

    The model decides the exact slide count within the requested length."""
    try:
        return await asyncio.to_thread(
            run_extend,
            body.source_text,
            body.topic,
            body.length,
            body.provider,
            body.model,
            x_hermes_api_key,
            body.design_hint,
        )
    except SlidesRunError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/slides/export")
def export_slides(body: SlidesExportInput) -> Response:
    """Build one downloadable .pptx: original slides first, AI slides appended.

    PPTX originals are kept intact with new slides styled to match; PDF
    originals arrive as client-rendered page images embedded full-bleed.
    No model call.
    """
    try:
        original_bytes = decode_original_pptx(body.original_pptx_base64)
        original_images = decode_image_list(body.original_images_base64)
        data = build_full_deck_pptx(
            body.original_filename,
            body.topic,
            [slide.model_dump() for slide in body.slides],
            original_bytes,
            original_images,
            body.divider_title,
            body.divider_note,
        )
    except SlidesRunError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except Exception as exc:
        logger.exception("Slide export failed")
        raise HTTPException(422, "This deck could not be exported. Try fewer slides or re-upload the original file.") from exc
    safe = "".join(c if c.isalnum() or c in ("-", "_", ".") else "_" for c in body.original_filename)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="extended-{safe or "slides"}.pptx"'},
    )


@app.post("/api/transcribe")
async def transcribe_voice(audio: UploadFile = File(...)) -> dict:
    """Transcribe a short recorded voice clip with Gemini 3.5 Transcribe.

    The browser records with MediaRecorder and posts the finished clip;
    FastAPI forwards the bytes to Google with the server GEMINI_API_KEY
    (the same key the Hermes gateway uses for generation) and returns
    ``{"text": ...}``. Audio stays in memory and is never stored; the
    transcript is a composer draft until the student presses Send through
    the normal chat path.
    """
    # Bounded read: the size check in transcribe_audio must not come after buffering an unlimited body.
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    try:
        text = await asyncio.to_thread(transcribe_audio, data, audio.content_type, audio.filename)
    except TranscribeError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    return {"text": text}


@app.get("/api/agent-runs/{run_id}")
def get_run(run_id: str, db: Db, user: CurrentUser) -> dict:
    run = owned_run(db, run_id, user)
    return {"id": run.id, "hermes_run_id": run.hermes_run_id, "status": run.status, "stage": run.stage, "error": run.error,
            "progress": _live_progress(run)}


def cancel_run_row(db: Session, run: AgentRun) -> dict:
    """Mark a run stopped so the UI unsticks and run_agent discards late output.

    The gateway run itself is left to finish server-side; run_agent's
    cooperative check (see app.hermes.RunCancelled) discards its answer
    instead of overwriting the cancellation.
    """
    if run.status not in {"completed", "failed", "cancelled"}:
        run.status = "cancelled"
        run.stage = "Cancelled"
        run.error = "Stopped by the student"
        run.finished_at = now()
        db.commit()
    return {"id": run.id, "status": run.status, "stage": run.stage, "error": run.error}


@app.post("/api/agent-runs/{run_id}/cancel")
def cancel_run(run_id: str, db: Db, user: CurrentUser) -> dict:
    """Stop a generating Hermes run. Safe to call when it already finished."""
    run = owned_run(db, run_id, user)
    return cancel_run_row(db, run)


@app.post("/api/chat/threads/{thread_id}/runs/cancel")
def cancel_latest_run(thread_id: str, db: Db, user: CurrentUser) -> dict:
    """Stop the thread's live run without the client tracking its id.

    Used by the global background indicator after the chat unmounted, and
    when Stop is pressed during the tiny window before the new run id arrives.
    """
    owned_thread(db, thread_id, user)
    run = db.scalar(select(AgentRun).where(AgentRun.thread_id == thread_id).order_by(AgentRun.created_at.desc(), AgentRun.id.desc()))
    if run is None or run.status in {"completed", "failed", "cancelled"}:
        return {"run": None}
    return {"run": cancel_run_row(db, run)}


def _live_progress(run: AgentRun) -> dict | None:
    """What the student is shown about a run right now: phase, tool and finished steps only.

    `hermes.RunProgress`/`LIVE_PROGRESS` also tracks the model name, token count/speed and a raw
    interim/preview of the reply text — useful server-side (logs, the settings test), but none of
    it is for the student: a model name or raw reasoning/preview text leaking into the chat UI is
    exactly what AGENTS.md says to prevent in the API, not only in the prompt or the frontend. This
    is the one place that response crosses the wire, so it's sanitized here regardless of what the
    frontend currently chooses to render. `server_now` lets the browser tick elapsed times without
    trusting its own clock.
    """
    live = LIVE_PROGRESS.get(run.id)
    if live is None or run.status in {"completed", "failed", "cancelled"}:
        return None
    return {
        "phase": live.get("phase"),
        "tool": live.get("tool"),
        "model": None,
        "started_at": live.get("started_at"),
        "phase_since": live.get("phase_since"),
        "tokens": 0,
        "tps": None,
        "preview": "",
        "steps": live.get("steps", []),
        "notice": None,
        "attempt": live.get("attempt", 0),
        "server_now": time.time(),
    }


def _run_status(run_id: str) -> tuple[str, bool] | None:
    db = SessionLocal()
    try:
        run = db.get(AgentRun, run_id)
        if run is None:
            return None
        return json.dumps({"status": run.status, "stage": run.stage, "error": run.error, "progress": _live_progress(run)}), run.status in {"completed", "failed", "cancelled"}
    finally:
        db.close()


@app.get("/api/agent-runs/{run_id}/events")
def run_events(run_id: str, db: Db, user: StreamUser) -> StreamingResponse:
    owned_run(db, run_id, user)

    async def stream():
        # Async with to_thread reads: an open stream holds no worker thread while it waits.
        last = None
        # Room for several fallback models (see app.hermes.execute_with_fallback).
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            state = await asyncio.to_thread(_run_status, run_id)
            if state is None:
                yield 'event: error\ndata: {"error":"Run not found"}\n\n'
                return
            payload, terminal = state
            if payload != last:
                yield f"event: status\ndata: {payload}\n\n"
                last = payload
            if terminal:
                return
            await asyncio.sleep(0.5)
        yield 'event: error\ndata: {"error":"Event stream timed out"}\n\n'
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/roadmap-proposals/{proposal_id}")
def get_proposal(proposal_id: str, db: Db, user: CurrentUser) -> dict:
    return proposal_dict(owned_proposal(db, proposal_id, user))


@app.post("/api/roadmap-proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, db: Db, user: CurrentUser, body: AcceptInput = Body(default_factory=AcceptInput)) -> dict:
    proposal = owned_proposal(db, proposal_id, user)
    if proposal.status != "pending":
        raise HTTPException(409, "Proposal is no longer pending")
    current = active_roadmap(db, proposal.student_id)
    if current.id != proposal.base_version_id:
        raise HTTPException(409, "Proposal is stale because the roadmap has changed")
    if proposal.kind == "initial":
        base = RoadmapSnapshot.model_validate_json(current.snapshot_json)
        if base.nodes:
            raise HTTPException(409, "A first roadmap can only replace the empty onboarding roadmap")
        try:
            updated = RoadmapSnapshot.model_validate_json(proposal.snapshot_json or "")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        # The student's review: anything they unticked starts from scratch.
        unticked = set(body.not_done)
        for node in updated.nodes:
            if node.id in unticked:
                node.status = "not-started"
    else:
        operations = ProposalCreate.model_validate({
            "user_id": proposal.student_id,
            "base_version_id": proposal.base_version_id,
            "summary": proposal.summary,
            "reasoning": proposal.reasoning,
            "operations": json.loads(proposal.operations_json),
        }).operations
        try:
            updated = apply_operations(RoadmapSnapshot.model_validate_json(current.snapshot_json), operations)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    # Claim the proposal and retire the base version with conditional updates, so two
    # concurrent accepts (a double click, or two proposals on one base) cannot both win.
    claimed = db.execute(
        update(RoadmapProposal).where(RoadmapProposal.id == proposal.id, RoadmapProposal.status == "pending")
        .values(status="accepted", decided_at=now()).execution_options(synchronize_session=False)
    ).rowcount
    retired = db.execute(
        update(RoadmapVersion).where(RoadmapVersion.id == current.id, RoadmapVersion.active.is_(True))
        .values(active=False).execution_options(synchronize_session=False)
    ).rowcount
    if not claimed or not retired:
        db.rollback()
        raise HTTPException(409, "This proposal was already decided or the roadmap changed; refresh and try again")
    version = RoadmapVersion(student_id=proposal.student_id, version=current.version + 1, snapshot_json=updated.model_dump_json(), reason=proposal.summary, active=True)
    db.add(version)
    for node in updated.nodes:
        if node.nodeType == "opportunity" and node.opportunity:
            recommendation = db.scalar(select(StudentOpportunity).where(
                StudentOpportunity.student_id == proposal.student_id,
                StudentOpportunity.opportunity_id == node.opportunity.opportunity_id,
            ))
            if recommendation is not None:
                recommendation.status = "added"
                recommendation.seen_at = now()
    if proposal.kind == "initial":
        profile = db.get(StudentProfile, proposal.student_id)
        if profile is not None:
            profile.onboarding_status = "done"
    db.flush()
    recompute_student(db, proposal.student_id)
    db.commit()
    return {"status": "accepted", "version_id": version.id, "version": version.version}


@app.post("/api/roadmap-proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: str, db: Db, user: CurrentUser) -> dict:
    proposal = owned_proposal(db, proposal_id, user)
    rejected = db.execute(
        update(RoadmapProposal).where(RoadmapProposal.id == proposal.id, RoadmapProposal.status == "pending")
        .values(status="rejected", decided_at=now()).execution_options(synchronize_session=False)
    ).rowcount
    if not rejected:
        raise HTTPException(409, "Proposal is no longer pending")
    db.commit()
    return {"status": "rejected"}


# Every student tool below is authorized by the run's grant (app.tool_grants): the student is the
# grant's, and a model-supplied id naming anyone else is refused.
@app.get("/internal/hermes/students/{student_id}/context")
def internal_context(student_id: str, db: Db, grant: ReadGrant) -> dict:
    return _context_dict(db, require_student(db, student_for(db, grant, student_id)))


@app.get("/internal/hermes/students/{student_id}/hackathons")
def internal_hackathons(student_id: str, db: Db, grant: HackathonsGrant, query: str = "", limit: int = 5) -> dict:
    return find_hackathons(db, student_for(db, grant, student_id), query, max(1, min(limit, 5)))


@app.post("/internal/opportunities/sync/hackathonat", dependencies=[Depends(require_internal)])
def internal_sync_hackathonat(db: Db) -> dict:
    try:
        return sync_hackathonat(db)
    except Exception as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/internal/hermes/students/{student_id}/roadmap")
def internal_roadmap(student_id: str, db: Db, grant: ReadGrant) -> dict:
    return _roadmap_dict(db, student_for(db, grant, student_id))


FACT_RECORDED_NOTE = "Stored. Do not record this fact again in this run; continue with your reply."


@app.post("/internal/hermes/facts")
def record_fact(body: FactCreate, db: Db, grant: FactsGrant) -> dict:
    if not body.explicit:
        raise HTTPException(422, "Only explicit student facts may be stored")
    student = require_student(db, student_for(db, grant, body.user_id))
    if body.source_message_id:
        # A fact must point at something the student actually said in their own thread.
        require_own_message(db, student.id, body.source_message_id)
    existing = db.scalars(select(StudentFact).where(StudentFact.student_id == student.id, StudentFact.category == body.category, StudentFact.key == body.key, StudentFact.active.is_(True))).all()
    value_json = json.dumps(body.value)
    same = next((fact for fact in existing if fact.value_json.casefold() == value_json.casefold()), None)
    if same is not None:
        # Models re-sent the same fact up to five times a turn when the reply did not say it was done;
        # each copy cost a full model round trip and churned the profile. Recording is idempotent.
        return {"success": True, "fact_id": same.id, "already_recorded": True, "note": FACT_RECORDED_NOTE}
    for fact in existing:
        fact.active = False
    fact = StudentFact(student_id=student.id, category=body.category, key=body.key, value_json=value_json, source_message_id=body.source_message_id, source_kind=body.source_kind, confidence=100)
    db.add(fact)
    db.flush()
    recompute_student(db, student.id)
    db.commit()
    return {"success": True, "fact_id": fact.id, "note": FACT_RECORDED_NOTE}


@app.get("/internal/hermes/students/{student_id}/profile")
def internal_profile(student_id: str, db: Db, grant: ReadGrant) -> dict:
    return build_profile_brief(db, student_for(db, grant, student_id))


@app.post("/internal/hermes/evidence")
def submit_evidence(body: EvidenceSubmit, db: Db, grant: EvidenceGrant) -> dict:
    """Hermes' folder scan results. Stored as `suggested` until the student confirms."""
    student_id = student_for(db, grant, body.user_id)
    source = db.get(DataSource, body.source_id)
    if source is None or source.student_id != student_id or (grant.source_id and grant.source_id != source.id):
        raise HTTPException(404, "Source not found for this student")
    if source.kind != "folder":
        raise HTTPException(422, "Hermes may only submit evidence for folder sources")
    if body.root and not _same_folder(body.root, json.loads(source.config_json).get("path", "")):
        raise HTTPException(422, "These results are for a different folder than the student typed")
    student = require_student(db, student_id)
    added = store_evidence(db, student.id, source.id, body.items)
    db.commit()
    return {"success": True, "added": added, "status": "awaiting student review"}


def _same_folder(scanned_root: str, typed_path: str) -> bool:
    """The scan ran on the student's machine (paths may differ from this server's view):
    compare the last two folder names, case-insensitively."""
    def tail(path: str) -> list[str]:
        parts = [part for part in path.replace("\\", "/").rstrip("/").split("/") if part and part != "~"]
        return [part.lower() for part in parts[-2:]]
    typed = tail(typed_path)
    return bool(typed) and tail(scanned_root)[-len(typed):] == typed


@app.post("/internal/hermes/roadmap-proposals")
def create_proposal(body: ProposalCreate, db: Db, grant: ProposalsGrant) -> dict:
    student = require_student(db, student_for(db, grant, body.user_id))
    current = active_roadmap(db, student.id)
    if current.id != body.base_version_id:
        raise HTTPException(409, "The proposal base version is stale")
    try:
        operations = normalize_opportunity_operations(db, student.id, body.operations)
        apply_operations(RoadmapSnapshot.model_validate_json(current.snapshot_json), operations)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    item = RoadmapProposal(student_id=student.id, base_version_id=body.base_version_id, summary=body.summary, reasoning=body.reasoning, operations_json=json.dumps([operation.model_dump() for operation in operations]))
    db.add(item)
    db.commit()
    return {"success": True, "proposal_id": item.id, "status": item.status}


from .outlook.coach import MailSearch, MailRead, search_mail, read_mail


@app.post("/internal/hermes/mail/search", dependencies=[Depends(require_internal)])
def coach_search_mail(body: MailSearch, db: Db):
    return search_mail(body, db)


@app.post("/internal/hermes/mail/read", dependencies=[Depends(require_internal)])
def coach_read_mail(body: MailRead, db: Db):
    return read_mail(body, db)
