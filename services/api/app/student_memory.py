"""Per-student Hermes memory, owned by Waypoint.

Hermes' built-in memory is one MEMORY.md/USER.md per gateway home, shared by every student, team
and throwaway JSON session on this machine, so it is switched off in config.yaml. Instead Waypoint
stores short memories per student in SQLite, puts them into that student's coach/onboarding run
instructions (recall costs no tool call), and lets Hermes add or retire entries only through
`waypoint_remember` / `waypoint_forget` with a per-run grant. The student sees, edits and deletes
every entry in Settings > Memory, and can turn memory off.

Memory is supplemental, like the AGENTS.md invariant says: it never becomes a StudentFact, never
reaches team runs, and an entry Hermes writes must cite one of the student's own messages.
"""
from __future__ import annotations

import json
import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from .database import get_db
from .models import StudentHermesSettings, StudentMemory, now
from .ownership import OwnedStudent, require_own_message
from .sources.pdf_text import redact
from .tool_grants import MemoryGrant, student_for

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]

MAX_MEMORIES = 40
MAX_CONTENT = 300
# Characters of memory placed into one run's instructions (newest first).
PROMPT_BUDGET = 2400
Category = Literal["preference", "learning", "context", "other"]

SECRET = re.compile(
    r"(?i)\b(password|passcode|pin code|api[_ -]?key|secret|token)\b\s*[:=]|"
    r"\b(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|nvapi-[A-Za-z0-9_-]{16,}|hf_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b"
)


def _settings(db: Session, student_id: str) -> StudentHermesSettings:
    row = db.get(StudentHermesSettings, student_id)
    if row is None:
        row = StudentHermesSettings(student_id=student_id)
        db.add(row)
        db.flush()
    return row


def memory_enabled(db: Session, student_id: str) -> bool:
    row = db.get(StudentHermesSettings, student_id)
    return row is None or bool(row.memory_enabled)


def clean_content(text: str) -> str:
    """One tidy line, refused when it carries something memory must never hold."""
    content = re.sub(r"\s+", " ", text or "").strip()
    if not content:
        raise HTTPException(422, "Memory content is empty")
    if len(content) > MAX_CONTENT:
        raise HTTPException(422, f"Keep a memory under {MAX_CONTENT} characters: one short sentence")
    if SECRET.search(content):
        raise HTTPException(422, "Memory must never hold passwords, keys or tokens")
    if redact(content) != content:
        raise HTTPException(422, "Memory must not hold email addresses, phone numbers or ID numbers")
    return content


def _items(db: Session, student_id: str) -> list[StudentMemory]:
    return list(db.scalars(
        select(StudentMemory).where(StudentMemory.student_id == student_id)
        .order_by(StudentMemory.updated_at.desc(), StudentMemory.id)
    ).all())


def _dict(item: StudentMemory) -> dict:
    return {
        "id": item.id, "content": item.content, "category": item.category, "origin": item.origin,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def memory_instructions(db: Session, student_id: str) -> str:
    """The memory block for one student's coach/onboarding run."""
    if not memory_enabled(db, student_id):
        return ("Memory is OFF for this student: do not call waypoint_remember or waypoint_forget, and do not claim "
                "to remember earlier conversations beyond the messages in this thread.")
    lines, used = [], 0
    for item in _items(db, student_id):
        line = f"- [{item.id}] {item.content}"
        if used + len(line) > PROMPT_BUDGET:
            break
        lines.append(line)
        used += len(line)
    remembered = "\n".join(lines) if lines else "(nothing yet)"
    return (
        "Waypoint memory for this student (private to them; use it silently, cite ids only in "
        "waypoint_remember replaces_id or waypoint_forget). Follow the waypoint-memory skill.\n" + remembered
    )


def _upsert(db: Session, student_id: str, content: str, category: str, origin: str,
            source_message_id: str | None = None, replaces_id: str | None = None) -> StudentMemory:
    if replaces_id:
        existing = db.get(StudentMemory, replaces_id)
        if existing is None or existing.student_id != student_id:
            raise HTTPException(404, "replaces_id is not one of this student's memories")
        existing.content, existing.category, existing.origin = content, category, origin
        existing.source_message_id = source_message_id or existing.source_message_id
        existing.updated_at = now()
        return existing
    duplicate = db.scalar(select(StudentMemory).where(
        StudentMemory.student_id == student_id, func.lower(StudentMemory.content) == content.lower()))
    if duplicate is not None:
        duplicate.updated_at = now()
        return duplicate
    count = db.scalar(select(func.count()).select_from(StudentMemory).where(StudentMemory.student_id == student_id)) or 0
    if count >= MAX_MEMORIES:
        raise HTTPException(409, f"Memory is full ({MAX_MEMORIES} entries): pass replaces_id for an outdated entry or forget one first")
    item = StudentMemory(student_id=student_id, content=content, category=category, origin=origin, source_message_id=source_message_id)
    db.add(item)
    db.flush()
    return item


# --- Hermes tools ---------------------------------------------------------------------------------

class RememberInput(BaseModel):
    user_id: str | None = None
    content: str = Field(min_length=1, max_length=2000)
    category: Category = "other"
    source_message_id: str
    replaces_id: str | None = None


class ForgetInput(BaseModel):
    user_id: str | None = None
    memory_id: str


@router.post("/internal/hermes/memory")
def remember(body: RememberInput, db: Db, grant: MemoryGrant) -> dict:
    student_id = student_for(db, grant, body.user_id)
    if not memory_enabled(db, student_id):
        raise HTTPException(403, "The student turned memory off; do not store anything")
    # Like facts, a memory must come from something the student actually said in their own thread.
    source = require_own_message(db, student_id, body.source_message_id)
    item = _upsert(db, student_id, clean_content(body.content), body.category, "hermes", source.id, body.replaces_id)
    db.commit()
    return {"success": True, "memory_id": item.id}


@router.post("/internal/hermes/memory/forget")
def forget(body: ForgetInput, db: Db, grant: MemoryGrant) -> dict:
    student_id = student_for(db, grant, body.user_id)
    item = db.get(StudentMemory, body.memory_id)
    if item is None or item.student_id != student_id:
        raise HTTPException(404, "Memory not found for this student")
    db.delete(item)
    db.commit()
    return {"success": True}


# --- Settings > Memory ------------------------------------------------------------------------------

class MemorySettingsInput(BaseModel):
    enabled: bool


class MemoryCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    category: Category = "other"


class MemoryUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


def _listing(db: Session, student_id: str) -> dict:
    return {"enabled": memory_enabled(db, student_id), "limit": MAX_MEMORIES, "items": [_dict(item) for item in _items(db, student_id)]}


@router.get("/api/students/{student_id}/memory")
def list_memory(student: OwnedStudent, db: Db) -> dict:
    return _listing(db, student.id)


@router.put("/api/students/{student_id}/memory/settings")
def update_memory_settings(body: MemorySettingsInput, student: OwnedStudent, db: Db) -> dict:
    _settings(db, student.id).memory_enabled = body.enabled
    db.commit()
    return _listing(db, student.id)


@router.post("/api/students/{student_id}/memory", status_code=201)
def add_memory(body: MemoryCreate, student: OwnedStudent, db: Db) -> dict:
    _upsert(db, student.id, clean_content(body.content), body.category, "student")
    db.commit()
    return _listing(db, student.id)


@router.patch("/api/students/{student_id}/memory/{memory_id}")
def edit_memory(memory_id: str, body: MemoryUpdate, student: OwnedStudent, db: Db) -> dict:
    item = db.get(StudentMemory, memory_id)
    if item is None or item.student_id != student.id:
        raise HTTPException(404, "Memory not found")
    item.content = clean_content(body.content)
    item.origin = "student"
    item.updated_at = now()
    db.commit()
    return _listing(db, student.id)


@router.delete("/api/students/{student_id}/memory/{memory_id}")
def delete_memory(memory_id: str, student: OwnedStudent, db: Db) -> dict:
    item = db.get(StudentMemory, memory_id)
    if item is None or item.student_id != student.id:
        raise HTTPException(404, "Memory not found")
    db.delete(item)
    db.commit()
    return _listing(db, student.id)


@router.delete("/api/students/{student_id}/memory")
def clear_memory(student: OwnedStudent, db: Db) -> dict:
    db.execute(delete(StudentMemory).where(StudentMemory.student_id == student.id))
    db.commit()
    return _listing(db, student.id)


def disabled_connectors(db: Session, student_id: str) -> set[str]:
    row = db.get(StudentHermesSettings, student_id)
    if row is None:
        return set()
    try:
        value = json.loads(row.connectors_off_json or "[]")
    except json.JSONDecodeError:
        return set()
    return {str(item) for item in value} if isinstance(value, list) else set()


def set_connector(db: Session, student_id: str, connector_id: str, enabled: bool) -> None:
    off = disabled_connectors(db, student_id)
    if enabled:
        off.discard(connector_id)
    else:
        off.add(connector_id)
    _settings(db, student_id).connectors_off_json = json.dumps(sorted(off))
