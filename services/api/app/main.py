from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, ensure_added_columns, get_db
from .disciplines import classify_program, public_registry
from .hermes import HERMES_API_KEY, HERMES_MODEL, HERMES_PROVIDER, HERMES_URL, HermesJsonError, resolve_hermes_selection, run_agent
from .models import AgentRun, ChatMessage, ChatThread, DataSource, EvidenceItem, RoadmapProposal, RoadmapVersion, Student, StudentFact, StudentProfile, now, uid
from .onboarding import UPLOAD_KINDS, build_profile_brief, generate_initial_roadmap, mark_synced, sync_remote, sync_upload
from .roadmaps import apply_operations
from .schemas import AcceptInput, ChatInput, EvidenceDecision, EvidenceSubmit, FactCreate, GenerateInput, HermesSettingsApply, ProfileUpdate, ProposalCreate, QuizGenerateInput, ResetInput, RewindInput, RoadmapSnapshot, SlidesExtendInput, SlidesExportInput, SlidesSuggestInput, SourceCreate, StudentCreate
from .sources import SourceError, normalize_value, store_evidence
from .sources.pdf_text import MAX_UPLOAD_BYTES
from .settings_env import ENV_PATH, write_env_values
from .quiz import QuizRunError, run_quiz
from .slides import SlidesRunError, build_full_deck_pptx, decode_image_list, decode_original_pptx, run_extend, run_suggest


STARTED_AT = time.time()


DEMO_STUDENT_ID = "demo-student"
ROADMAP_SEED_PATH = Path(__file__).resolve().parents[1] / "seed-roadmap.json"
INTERNAL_TOKEN = os.getenv("FARQ_INTERNAL_TOKEN", "farq-internal-dev")
Db = Annotated[Session, Depends(get_db)]
app = FastAPI(title="Farq Hermes Backbone", version="0.1.0")
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


def resolve_student(db: Session, user_id: str) -> Student | None:
    """Exact id first, else a unique case-insensitive display-name match.

    Hermes sometimes passes the display name it saw in chat instead of the
    UUID from the run header. Resolving it beats a 404 that silently drops
    onboarding facts and profile reads; unknown or ambiguous names return None.
    """
    student = db.get(Student, user_id)
    if student is not None:
        return student
    matches = db.scalars(select(Student).where(func.lower(Student.display_name) == user_id.strip().lower())).all()
    return matches[0] if len(matches) == 1 else None


def require_resolved_student(db: Session, user_id: str) -> Student:
    student = resolve_student(db, user_id)
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


EVIDENCE_FACT_CATEGORY = {
    "course": "course", "education": "course", "skill": "skill", "project": "achievement",
    "experience": "achievement", "certificate": "achievement", "publication": "achievement", "activity": "achievement",
}


def require_internal(x_farq_internal_token: Annotated[str | None, Header()] = None) -> None:
    if x_farq_internal_token != INTERNAL_TOKEN:
        raise HTTPException(401, "Invalid internal token")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
    ensure_added_columns()
    db = SessionLocal()
    try:
        if db.get(Student, DEMO_STUDENT_ID) is None:
            db.add(Student(id=DEMO_STUDENT_ID, display_name="Demo Student"))
            db.flush()
        if db.scalar(select(func.count()).select_from(RoadmapVersion).where(RoadmapVersion.student_id == DEMO_STUDENT_ID)) == 0:
            db.add(RoadmapVersion(student_id=DEMO_STUDENT_ID, version=1, snapshot_json=default_roadmap_snapshot().model_dump_json(), active=True))
        if db.scalar(select(func.count()).select_from(ChatThread).where(ChatThread.student_id == DEMO_STUDENT_ID)) == 0:
            db.add(ChatThread(student_id=DEMO_STUDENT_ID, title="My Hermes Coach"))
        db.commit()
    finally:
        db.close()


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
    return {"status": "ok", "database": "ready", "agent": agent, "started_at": STARTED_AT, "model": HERMES_MODEL, "provider": HERMES_PROVIDER}


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
    db.execute(delete(StudentFact).where(StudentFact.student_id == DEMO_STUDENT_ID))
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
    db.commit()
    return {**profile_dict(student, db.get(StudentProfile, student.id)), "thread_id": first_thread(db, student.id).id}


def first_thread(db: Session, student_id: str) -> ChatThread:
    thread = db.scalar(select(ChatThread).where(ChatThread.student_id == student_id).order_by(ChatThread.created_at))
    if thread is None:
        raise HTTPException(404, "Student has no chat thread")
    return thread


@app.get("/api/disciplines")
def disciplines() -> list[dict]:
    return public_registry()


@app.get("/api/students/{student_id}/profile")
def get_profile(student_id: str, db: Db) -> dict:
    student = require_student(db, student_id)
    return {**profile_dict(student, db.get(StudentProfile, student_id)), "thread_id": first_thread(db, student_id).id}


@app.put("/api/students/{student_id}/profile")
def update_profile(student_id: str, body: ProfileUpdate, db: Db) -> dict:
    student = require_student(db, student_id)
    profile = db.get(StudentProfile, student_id)
    if profile is None:
        profile = StudentProfile(student_id=student_id)
        db.add(profile)
    changes = body.model_dump(exclude_none=True)
    for key, value in changes.items():
        setattr(profile, key, value.strip() if isinstance(value, str) else value)
    if "program" in changes and "discipline" not in changes:
        profile.discipline = classify_program(profile.program)
    db.commit()
    return {**profile_dict(student, profile), "thread_id": first_thread(db, student_id).id}


@app.get("/api/students/{student_id}/sources")
def list_sources(student_id: str, db: Db) -> list[dict]:
    require_student(db, student_id)
    items = db.scalars(select(DataSource).where(DataSource.student_id == student_id).order_by(DataSource.created_at)).all()
    return [source_dict(item) for item in items]


@app.post("/api/students/{student_id}/sources", status_code=201)
def add_source(student_id: str, body: SourceCreate, db: Db) -> dict:
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
def delete_source(student_id: str, source_id: str, db: Db) -> dict:
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
    try:
        source = db.get(DataSource, source_id)
        source.status = "syncing"
        db.commit()
        try:
            added = job(db, source)
        except SourceError as exc:
            db.rollback()
            source = db.get(DataSource, source_id)
            mark_synced(source, str(exc))
            db.commit()
            raise
        mark_synced(source)
        db.commit()
        return {**source_dict(source), "added": added}
    finally:
        db.close()


@app.post("/api/students/{student_id}/sources/{source_id}/upload")
async def upload_source(
    student_id: str,
    source_id: str,
    db: Db,
    file: UploadFile = File(...),
    provider: str | None = Form(default=None),
    model: str | None = Form(default=None),
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Read an uploaded transcript/CV/LinkedIn file into suggested evidence.

    The file itself is never stored; only the extracted, redacted evidence is.
    """
    source = db.get(DataSource, source_id)
    if source is None or source.student_id != student_id:
        raise HTTPException(404, "Source not found")
    if source.kind not in UPLOAD_KINDS:
        raise HTTPException(422, "This source is not a file upload")
    data = await file.read(MAX_UPLOAD_BYTES * 3 + 1)
    hermes = _hermes_opts(provider or None, model or None, x_hermes_api_key)
    try:
        return await asyncio.to_thread(_run_source_job, source_id, lambda session, src: sync_upload(session, src, data, file.filename or "", hermes))
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.post("/api/students/{student_id}/sources/{source_id}/sync")
async def sync_source(
    student_id: str,
    source_id: str,
    db: Db,
    body: GenerateInput = Body(default_factory=GenerateInput),
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    source = db.get(DataSource, source_id)
    if source is None or source.student_id != student_id:
        raise HTTPException(404, "Source not found")
    if source.kind in UPLOAD_KINDS:
        raise HTTPException(422, "Upload a file for this source")
    hermes = _hermes_opts(body.provider, body.model, x_hermes_api_key)
    try:
        return await asyncio.to_thread(_run_source_job, source_id, lambda session, src: sync_remote(session, src, hermes))
    except SourceError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@app.get("/api/students/{student_id}/evidence")
def list_evidence(student_id: str, db: Db) -> list[dict]:
    require_student(db, student_id)
    items = db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student_id, EvidenceItem.status != "dismissed").order_by(EvidenceItem.kind, EvidenceItem.created_at)).all()
    return [evidence_dict(item) for item in items]


@app.post("/api/students/{student_id}/evidence/decide")
def decide_evidence(student_id: str, body: EvidenceDecision, db: Db) -> dict:
    """The student's explicit review: confirmed evidence becomes StudentFacts.

    Ticking an item is an explicit statement by the student, so it is the one
    non-chat path into StudentFact (source_kind="confirmed_evidence").
    """
    require_student(db, student_id)
    ids = set(body.confirm) | set(body.dismiss)
    items = {item.id: item for item in db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student_id, EvidenceItem.id.in_(ids))).all()}
    for evidence_id in body.dismiss:
        item = items.get(evidence_id)
        if item is None:
            continue
        item.status = "dismissed"
        for fact in db.scalars(select(StudentFact).where(StudentFact.evidence_id == evidence_id, StudentFact.active.is_(True))).all():
            fact.active = False
    confirmed = 0
    for evidence_id in body.confirm:
        item = items.get(evidence_id)
        if item is None or evidence_id in body.dismiss:
            continue
        title = body.titles.get(evidence_id, "").strip()
        if title:
            item.title = title[:240]
        item.status = "confirmed"
        for fact in db.scalars(select(StudentFact).where(StudentFact.evidence_id == evidence_id, StudentFact.active.is_(True))).all():
            fact.active = False
        data = json.loads(item.data_json)
        data.pop("readme_excerpt", None)
        db.add(StudentFact(
            student_id=student_id,
            category=EVIDENCE_FACT_CATEGORY[item.kind],
            key=f"{item.kind}: {item.title}"[:120],
            value_json=json.dumps({k: v for k, v in data.items() if v not in ("", [], None)}),
            source_kind="confirmed_evidence",
            evidence_id=item.id,
            confidence=100,
        ))
        confirmed += 1
    db.commit()
    return {"confirmed": confirmed, "dismissed": len([i for i in body.dismiss if i in items])}


@app.post("/api/students/{student_id}/onboarding/generate")
async def generate_roadmap(
    student_id: str,
    db: Db,
    body: GenerateInput = Body(default_factory=GenerateInput),
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Ask Hermes for a whole first roadmap and store it as an `initial` proposal.

    Only the accept endpoint activates it. Allowed while the active roadmap is
    still the empty v0.
    """
    require_student(db, student_id)
    current = active_roadmap(db, student_id)
    if RoadmapSnapshot.model_validate_json(current.snapshot_json).nodes:
        raise HTTPException(409, "This student already has a roadmap; ask Hermes Coach to revise it instead")
    profile = db.get(StudentProfile, student_id)
    base_id = current.id
    hermes = _hermes_opts(body.provider, body.model, x_hermes_api_key)

    def job() -> dict:
        session = SessionLocal()
        try:
            snapshot = generate_initial_roadmap(session, student_id, hermes)
            for stale in session.scalars(select(RoadmapProposal).where(RoadmapProposal.student_id == student_id, RoadmapProposal.kind == "initial", RoadmapProposal.status == "pending")).all():
                stale.status = "rejected"
                stale.decided_at = now()
            proposal = RoadmapProposal(
                student_id=student_id, base_version_id=base_id, kind="initial",
                summary=f"First roadmap: {snapshot.title}"[:240],
                reasoning="Generated from your confirmed evidence and onboarding answers.",
                operations_json="[]", snapshot_json=snapshot.model_dump_json(),
            )
            session.add(proposal)
            saved_profile = session.get(StudentProfile, student_id)
            if saved_profile is not None:
                saved_profile.onboarding_status = "preview"
            session.commit()
            return proposal_dict(proposal)
        finally:
            session.close()

    if profile is not None:
        profile.onboarding_status = "generating"
        db.commit()
    try:
        return await asyncio.to_thread(job)
    except Exception as exc:
        if profile is not None:
            profile.onboarding_status = "chat"
            db.commit()
        if isinstance(exc, HermesJsonError):
            raise HTTPException(exc.status, str(exc)) from exc
        raise


@app.get("/api/students/{student_id}/context")
def student_context(student_id: str, db: Db) -> dict:
    student = require_resolved_student(db, student_id)
    facts = db.scalars(select(StudentFact).where(StudentFact.student_id == student_id, StudentFact.active.is_(True)).order_by(StudentFact.created_at)).all()
    return {
        "id": student.id,
        "display_name": student.display_name,
        "facts": [
            {"id": fact.id, "category": fact.category, "key": fact.key, "value": json.loads(fact.value_json), "confidence": fact.confidence}
            for fact in facts
        ],
    }


@app.get("/api/students/{student_id}/roadmap")
def get_roadmap(student_id: str, db: Db) -> dict:
    student = require_resolved_student(db, student_id)
    item = active_roadmap(db, student.id)
    return {"version_id": item.id, "version": item.version, "reason": item.reason, "snapshot": json.loads(item.snapshot_json)}


@app.put("/api/students/{student_id}/roadmap/nodes/{node_id}")
def update_progress(student_id: str, node_id: str, body: dict, db: Db) -> dict:
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


@app.get("/api/students/{student_id}/roadmap/proposals")
def list_proposals(student_id: str, db: Db) -> list[dict]:
    items = db.scalars(select(RoadmapProposal).where(RoadmapProposal.student_id == student_id).order_by(RoadmapProposal.created_at.desc())).all()
    return [proposal_dict(item) for item in items]


@app.get("/api/chat/threads/{thread_id}/messages")
def messages(thread_id: str, db: Db) -> list[dict]:
    items = db.scalars(select(ChatMessage).where(ChatMessage.thread_id == thread_id).order_by(ChatMessage.created_at)).all()
    return [{"id": item.id, "role": item.role, "content": item.content, "agent_run_id": item.agent_run_id, "created_at": item.created_at.isoformat()} for item in items]


@app.post("/api/chat/threads/{thread_id}/messages", status_code=202)
def send_message(
    thread_id: str,
    body: ChatInput,
    background: BackgroundTasks,
    db: Db,
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    thread = db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(404, "Thread not found")
    try:
        resolve_hermes_selection(body.provider, body.model)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    message = ChatMessage(thread_id=thread_id, role="user", content=body.content.strip())
    db.add(message)
    db.flush()
    run = AgentRun(thread_id=thread_id, user_message_id=message.id)
    db.add(run)
    db.flush()
    message.agent_run_id = run.id
    db.commit()
    background.add_task(run_agent, run.id, thread.student_id, body.provider, body.model, x_hermes_api_key)
    return {"run_id": run.id, "message_id": message.id, "status": run.status}


@app.post("/api/chat/threads/{thread_id}/rewind")
def rewind_thread(thread_id: str, body: RewindInput, db: Db) -> dict:
    """Edit-and-resend: drop a user message and everything after it.

    The edited prompt is then sent as a fresh message, so the thread reads
    as if the old turn never happened instead of stacking a duplicate.
    Rejected while a run is still live (it would append onto the rewind).
    Gateway-side session memory is not rewound — only the stored history.
    """
    thread = db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(404, "Thread not found")
    live = db.scalar(select(func.count()).select_from(AgentRun).where(
        AgentRun.thread_id == thread_id, AgentRun.status.notin_(["completed", "failed", "cancelled"]),
    ))
    if live:
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


@app.post("/api/settings/hermes")
def apply_hermes_settings(body: HermesSettingsApply) -> dict:
    """Persist Settings-pane Hermes key/model to .env (takes effect on restart).

    The native runner watches .env and restarts its isolated API + gateway, so
    Apply in the UI is enough there. Other deployments must be restarted
    manually after a successful apply.
    """
    key = body.key.strip()
    updates = {"HERMES_API_KEY": key}
    if body.provider is not None or body.model is not None:
        try:
            model, provider = resolve_hermes_selection(body.provider, body.model)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        updates["HERMES_MODEL"] = model
        updates["HERMES_PROVIDER"] = provider
    try:
        write_env_values(updates, ENV_PATH)
    except FileNotFoundError as exc:
        raise HTTPException(409, "No .env file in this deployment; set HERMES_API_KEY in the server environment instead") from exc
    except OSError as exc:
        raise HTTPException(500, f"Could not write .env: {exc}") from exc
    return {"status": "applied", "model": updates.get("HERMES_MODEL"), "provider": updates.get("HERMES_PROVIDER"), "restart_required": True}


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
) -> dict:
    """Suggest extension topics for a deck through the Hermes gateway.

    Throwaway ``farq:slides:*`` session, no SQLite writes — same rule as
    quizzes: slide text is not an explicit student statement. When
    ``student_id`` is supplied, verified profile + active roadmap data are
    read from SQLite and injected server-side as prompt data; the model
    marks those topics ``source="roadmap"`` so the UI renders them
    identifiably differently from plain deck topics.
    """
    learner_context = ""
    if body.student_id:
        student = resolve_student(db, body.student_id.strip())
        if student is not None:
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
        )
    except SlidesRunError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    safe = "".join(c if c.isalnum() or c in ("-", "_", ".") else "_" for c in body.original_filename)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="extended-{safe or "slides"}.pptx"'},
    )


@app.get("/api/agent-runs/{run_id}")
def get_run(run_id: str, db: Db) -> dict:
    run = db.get(AgentRun, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return {"id": run.id, "hermes_run_id": run.hermes_run_id, "status": run.status, "stage": run.stage, "error": run.error}


@app.get("/api/agent-runs/{run_id}/events")
def run_events(run_id: str) -> StreamingResponse:
    def stream():
        last = None
        # Room for several fallback models (see app.hermes.execute_with_fallback).
        deadline = time.monotonic() + 420
        while time.monotonic() < deadline:
            db = SessionLocal()
            run = db.get(AgentRun, run_id)
            if run is None:
                db.close()
                yield 'event: error\ndata: {"error":"Run not found"}\n\n'
                return
            payload = json.dumps({"status": run.status, "stage": run.stage, "error": run.error})
            terminal = run.status in {"completed", "failed", "cancelled"}
            db.close()
            if payload != last:
                yield f"event: status\ndata: {payload}\n\n"
                last = payload
            if terminal:
                return
            time.sleep(0.5)
        yield 'event: error\ndata: {"error":"Event stream timed out"}\n\n'
    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/api/roadmap-proposals/{proposal_id}")
def get_proposal(proposal_id: str, db: Db) -> dict:
    item = db.get(RoadmapProposal, proposal_id)
    if item is None:
        raise HTTPException(404, "Proposal not found")
    return proposal_dict(item)


@app.post("/api/roadmap-proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, db: Db, body: AcceptInput = Body(default_factory=AcceptInput)) -> dict:
    proposal = db.get(RoadmapProposal, proposal_id)
    if proposal is None or proposal.status != "pending":
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
    current.active = False
    version = RoadmapVersion(student_id=proposal.student_id, version=current.version + 1, snapshot_json=updated.model_dump_json(), reason=proposal.summary, active=True)
    db.add(version)
    proposal.status = "accepted"
    proposal.decided_at = now()
    if proposal.kind == "initial":
        profile = db.get(StudentProfile, proposal.student_id)
        if profile is not None:
            profile.onboarding_status = "done"
    db.commit()
    return {"status": "accepted", "version_id": version.id, "version": version.version}


@app.post("/api/roadmap-proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: str, db: Db) -> dict:
    proposal = db.get(RoadmapProposal, proposal_id)
    if proposal is None or proposal.status != "pending":
        raise HTTPException(409, "Proposal is no longer pending")
    proposal.status = "rejected"
    proposal.decided_at = now()
    db.commit()
    return {"status": "rejected"}


@app.get("/internal/hermes/students/{student_id}/context", dependencies=[Depends(require_internal)])
def internal_context(student_id: str, db: Db) -> dict:
    return student_context(student_id, db)


@app.get("/internal/hermes/students/{student_id}/roadmap", dependencies=[Depends(require_internal)])
def internal_roadmap(student_id: str, db: Db) -> dict:
    return get_roadmap(student_id, db)


@app.post("/internal/hermes/facts", dependencies=[Depends(require_internal)])
def record_fact(body: FactCreate, db: Db) -> dict:
    if not body.explicit:
        raise HTTPException(422, "Only explicit student facts may be stored")
    student = require_resolved_student(db, body.user_id)
    existing = db.scalars(select(StudentFact).where(StudentFact.student_id == student.id, StudentFact.category == body.category, StudentFact.key == body.key, StudentFact.active.is_(True))).all()
    for fact in existing:
        fact.active = False
    fact = StudentFact(student_id=student.id, category=body.category, key=body.key, value_json=json.dumps(body.value), source_message_id=body.source_message_id, source_kind=body.source_kind, confidence=100)
    db.add(fact)
    db.commit()
    return {"success": True, "fact_id": fact.id}


@app.get("/internal/hermes/students/{student_id}/profile", dependencies=[Depends(require_internal)])
def internal_profile(student_id: str, db: Db) -> dict:
    student = require_resolved_student(db, student_id)
    return build_profile_brief(db, student.id)


@app.post("/internal/hermes/evidence", dependencies=[Depends(require_internal)])
def submit_evidence(body: EvidenceSubmit, db: Db) -> dict:
    """Hermes' folder scan results. Stored as `suggested` until the student confirms."""
    student = require_resolved_student(db, body.user_id)
    source = db.get(DataSource, body.source_id)
    if source is None or source.student_id != student.id:
        raise HTTPException(404, "Source not found for this student")
    added = store_evidence(db, student.id, source.id, body.items)
    db.commit()
    return {"success": True, "added": added, "status": "awaiting student review"}


@app.post("/internal/hermes/roadmap-proposals", dependencies=[Depends(require_internal)])
def create_proposal(body: ProposalCreate, db: Db) -> dict:
    student = require_resolved_student(db, body.user_id)
    current = active_roadmap(db, student.id)
    if current.id != body.base_version_id:
        raise HTTPException(409, "The proposal base version is stale")
    try:
        apply_operations(RoadmapSnapshot.model_validate_json(current.snapshot_json), body.operations)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    item = RoadmapProposal(student_id=student.id, base_version_id=body.base_version_id, summary=body.summary, reasoning=body.reasoning, operations_json=json.dumps([operation.model_dump() for operation in body.operations]))
    db.add(item)
    db.commit()
    return {"success": True, "proposal_id": item.id, "status": item.status}
