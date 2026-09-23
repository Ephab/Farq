from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .hermes import HERMES_API_KEY, HERMES_MODEL, HERMES_PROVIDER, HERMES_URL, resolve_hermes_selection, run_agent
from .models import AgentRun, ChatMessage, ChatThread, RoadmapProposal, RoadmapVersion, Student, StudentFact, now, uid
from .roadmaps import apply_operations
from .schemas import ChatInput, FactCreate, HermesSettingsApply, ProposalCreate, QuizGenerateInput, ResetInput, RoadmapSnapshot, SlidesExtendInput, SlidesExportInput, SlidesSuggestInput
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
        "status": item.status,
        "created_at": item.created_at.isoformat(),
    }


def require_internal(x_farq_internal_token: Annotated[str | None, Header()] = None) -> None:
    if x_farq_internal_token != INTERNAL_TOKEN:
        raise HTTPException(401, "Invalid internal token")


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(engine)
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
        agent = "ready" if payload.get("status") in {"ok", "ready"} else "degraded"
    except Exception:
        agent = "unavailable"
    return {"status": "ok", "database": "ready", "agent": agent, "started_at": STARTED_AT, "model": HERMES_MODEL, "provider": HERMES_PROVIDER}


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


@app.get("/api/students/{student_id}/context")
def student_context(student_id: str, db: Db) -> dict:
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
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
    item = active_roadmap(db, student_id)
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
    x_hermes_api_key: Annotated[str | None, Header()] = None,
) -> dict:
    """Suggest extension topics for a deck through the Hermes gateway.

    Throwaway ``farq:slides:*`` session, no SQLite writes — same rule as
    quizzes: slide text is not an explicit student statement.
    """
    try:
        return await asyncio.to_thread(
            run_suggest,
            body.source_text,
            body.count,
            body.provider,
            body.model,
            x_hermes_api_key,
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
        deadline = time.monotonic() + 210
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
def accept_proposal(proposal_id: str, db: Db) -> dict:
    proposal = db.get(RoadmapProposal, proposal_id)
    if proposal is None or proposal.status != "pending":
        raise HTTPException(409, "Proposal is no longer pending")
    current = active_roadmap(db, proposal.student_id)
    if current.id != proposal.base_version_id:
        raise HTTPException(409, "Proposal is stale because the roadmap has changed")
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
    if db.get(Student, body.user_id) is None:
        raise HTTPException(404, "Student not found")
    existing = db.scalars(select(StudentFact).where(StudentFact.student_id == body.user_id, StudentFact.category == body.category, StudentFact.key == body.key, StudentFact.active.is_(True))).all()
    for fact in existing:
        fact.active = False
    fact = StudentFact(student_id=body.user_id, category=body.category, key=body.key, value_json=json.dumps(body.value), source_message_id=body.source_message_id, confidence=100)
    db.add(fact)
    db.commit()
    return {"success": True, "fact_id": fact.id}


@app.post("/internal/hermes/roadmap-proposals", dependencies=[Depends(require_internal)])
def create_proposal(body: ProposalCreate, db: Db) -> dict:
    current = active_roadmap(db, body.user_id)
    if current.id != body.base_version_id:
        raise HTTPException(409, "The proposal base version is stale")
    try:
        apply_operations(RoadmapSnapshot.model_validate_json(current.snapshot_json), body.operations)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    item = RoadmapProposal(student_id=body.user_id, base_version_id=body.base_version_id, summary=body.summary, reasoning=body.reasoning, operations_json=json.dumps([operation.model_dump() for operation in body.operations]))
    db.add(item)
    db.commit()
    return {"success": True, "proposal_id": item.id, "status": item.status}
