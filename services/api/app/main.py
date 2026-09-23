from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .hermes import HERMES_API_KEY, HERMES_URL, run_agent
from .models import AgentRun, ChatMessage, ChatThread, RoadmapProposal, RoadmapVersion, Student, StudentFact, now
from .roadmaps import apply_operations
from .schemas import ChatInput, FactCreate, ProposalCreate, RoadmapSnapshot


DEMO_STUDENT_ID = "demo-student"
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
            seed = Path(__file__).resolve().parents[1] / "seed-roadmap.json"
            snapshot = RoadmapSnapshot.model_validate_json(seed.read_text(encoding="utf-8"))
            db.add(RoadmapVersion(student_id=DEMO_STUDENT_ID, version=1, snapshot_json=snapshot.model_dump_json(), active=True))
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
    return {"status": "ok", "database": "ready", "agent": agent}


@app.get("/api/demo")
def demo(db: Db) -> dict:
    thread = db.scalar(select(ChatThread).where(ChatThread.student_id == DEMO_STUDENT_ID).order_by(ChatThread.created_at))
    return {"student_id": DEMO_STUDENT_ID, "thread_id": thread.id}


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
def send_message(thread_id: str, body: ChatInput, background: BackgroundTasks, db: Db) -> dict:
    thread = db.get(ChatThread, thread_id)
    if thread is None:
        raise HTTPException(404, "Thread not found")
    message = ChatMessage(thread_id=thread_id, role="user", content=body.content.strip())
    db.add(message)
    db.flush()
    run = AgentRun(thread_id=thread_id, user_message_id=message.id)
    db.add(run)
    db.flush()
    message.agent_run_id = run.id
    db.commit()
    background.add_task(run_agent, run.id, thread.student_id)
    return {"run_id": run.id, "message_id": message.id, "status": run.status}


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
