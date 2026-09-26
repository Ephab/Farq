from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .common import Db, aware, iso, loads, require, require_team
from .events import emit
from .models import DocSection, Team, TeamDocument, TeamMember
from .policy import authorize

router = APIRouter()
LOCK_SECONDS = 90

# Section outlines follow IEEE 29148 (SRS), IEEE 1016 (SDS) and IEEE 1058 (SPMP).
OUTLINES: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "srs": ("Software Requirements Specification", [
        ("1", "Introduction"), ("1.1", "Purpose"), ("1.2", "Scope"), ("1.3", "Definitions and acronyms"),
        ("2", "Overall description"), ("2.1", "Product perspective"), ("2.2", "User classes and characteristics"),
        ("2.3", "Constraints and assumptions"), ("3", "Requirements"), ("3.1", "External interfaces"),
        ("3.2", "Functional requirements"), ("3.3", "Non-functional requirements"), ("4", "Verification"),
    ]),
    "sds": ("Software Design Specification", [
        ("1", "Introduction"), ("2", "Design stakeholders and concerns"), ("3", "Architecture view"),
        ("4", "Data design"), ("5", "Component design"), ("6", "Interface design"), ("7", "Requirements traceability"),
    ]),
    "spmp": ("Software Project Management Plan", [
        ("1", "Overview"), ("2", "Project organization"), ("3", "Managerial process"), ("3.1", "Estimates"),
        ("3.2", "Schedule"), ("3.3", "Risk management"), ("4", "Technical process"), ("5", "Supporting processes"),
    ]),
}


class SectionSpec(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    title: str = Field(min_length=1, max_length=160)


class DocumentCreate(BaseModel):
    kind: Literal["srs", "sds", "spmp", "custom"]
    title: str | None = Field(default=None, max_length=160)
    sections: list[SectionSpec] | None = Field(default=None, max_length=60)


class SectionPatch(BaseModel):
    key: str | None = Field(default=None, min_length=1, max_length=16)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    owner_user_id: str | None = None


class DocumentPatch(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class SectionCreate(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    title: str = Field(min_length=1, max_length=160)
    after_section_id: str | None = None


class SectionMove(BaseModel):
    direction: Literal["up", "down"]


class SectionContent(BaseModel):
    content_md: str = Field(max_length=60000)
    version: int = Field(ge=0)


def section_dict(section: DocSection) -> dict:
    return {
        "id": section.id, "document_id": section.document_id, "key": section.key, "title": section.title,
        "position": section.position, "owner_user_id": section.owner_user_id, "content_md": section.content_md,
        "status": section.status, "lock_user_id": section.lock_user_id, "lock_expires_at": iso(section.lock_expires_at),
        "version": section.version, "meta": loads(section.meta_json, {}),
    }


def document_dict(document: TeamDocument, sections: list[DocSection]) -> dict:
    return {
        "id": document.id, "team_id": document.team_id, "kind": document.kind, "title": document.title,
        "created_at": iso(document.created_at), "sections": [section_dict(section) for section in sections],
    }


def lock_active(section: DocSection, at: datetime) -> bool:
    return section.lock_user_id is not None and section.lock_expires_at is not None and aware(section.lock_expires_at) > at


def _section_and_team(db: Session, section_id: str) -> tuple[DocSection, Team]:
    section = require(db, DocSection, section_id, "Section")
    document = db.get(TeamDocument, section.document_id)
    return section, require_team(db, document.team_id)


def new_document(db: Session, team_id: str, kind: str, actor: str | None, *, title: str | None = None,
                 specs: list[tuple[str, str]] | None = None) -> TeamDocument:
    """Create a document with its outline and emit `document.created`. The caller commits."""
    if specs is None:
        if kind not in OUTLINES:
            raise ValueError("A custom document needs at least one section")
        specs = OUTLINES[kind][1]
    if len({key for key, _ in specs}) != len(specs):
        raise ValueError("Section keys must be unique")
    default_title = OUTLINES[kind][0] if kind in OUTLINES else "Document"
    document = TeamDocument(team_id=team_id, kind=kind, title=(title or "").strip() or default_title)
    db.add(document)
    db.flush()
    sections = [DocSection(document_id=document.id, key=key, title=section_title, position=index) for index, (key, section_title) in enumerate(specs)]
    db.add_all(sections)
    db.flush()
    emit(db, team_id, "document.created", actor, document_dict(document, sections))
    return document


@router.post("/api/teams/{team_id}/documents", status_code=201)
def create_document(team_id: str, body: DocumentCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    specs = [(item.key.strip(), item.title.strip()) for item in body.sections] if body.sections else None
    try:
        document = new_document(db, team.id, body.kind, user.id, title=body.title, specs=specs)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    sections = db.scalars(select(DocSection).where(DocSection.document_id == document.id).order_by(DocSection.position)).all()
    payload = document_dict(document, sections)
    db.commit()
    return payload


@router.patch("/api/sections/{section_id}")
def update_section(section_id: str, body: SectionPatch, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    if "owner_user_id" in body.model_fields_set:
        if body.owner_user_id is not None and not db.scalar(
            select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == body.owner_user_id)
        ):
            raise HTTPException(422, "The owner must be a member of this team")
        section.owner_user_id = body.owner_user_id
    if body.key is not None and body.key.strip() != section.key:
        _require_free_key(db, section.document_id, body.key.strip())
        section.key = body.key.strip()
    if body.title is not None:
        section.title = body.title.strip() or section.title
    emit(db, team.id, "section.updated", user.id, section_dict(section))
    db.commit()
    return section_dict(section)


def _ordered(db: Session, document_id: str) -> list[DocSection]:
    return list(db.scalars(select(DocSection).where(DocSection.document_id == document_id).order_by(DocSection.position)).all())


def _require_free_key(db: Session, document_id: str, key: str) -> None:
    if any(item.key == key for item in _ordered(db, document_id)):
        raise HTTPException(422, f"This document already has a section {key}")


def _renumber(sections: list[DocSection]) -> None:
    for index, item in enumerate(sections):
        item.position = index


def _emit_document(db: Session, team: Team, document: TeamDocument, actor: str, change: dict) -> dict:
    """Structural edits send the whole document, plus what changed for the activity log."""
    payload = document_dict(document, _ordered(db, document.id))
    emit(db, team.id, "document.updated", actor, {"document": payload, "change": change})
    return payload


def _document_and_team(db: Session, document_id: str) -> tuple[TeamDocument, Team]:
    document = require(db, TeamDocument, document_id, "Document")
    return document, require_team(db, document.team_id)


@router.patch("/api/documents/{document_id}")
def rename_document(document_id: str, body: DocumentPatch, db: Db, user: CurrentUser) -> dict:
    document, team = _document_and_team(db, document_id)
    authorize(db, user, team, "write")
    document.title = body.title.strip() or document.title
    payload = _emit_document(db, team, document, user.id, {"action": "renamed", "title": document.title})
    db.commit()
    return payload


@router.post("/api/documents/{document_id}/sections", status_code=201)
def add_section(document_id: str, body: SectionCreate, db: Db, user: CurrentUser) -> dict:
    document, team = _document_and_team(db, document_id)
    authorize(db, user, team, "write")
    key, title = body.key.strip(), body.title.strip()
    if not key or not title:
        raise HTTPException(422, "A section needs a number and a title")
    _require_free_key(db, document.id, key)
    sections = _ordered(db, document.id)
    index = len(sections)
    if body.after_section_id:
        index = next((i + 1 for i, item in enumerate(sections) if item.id == body.after_section_id), None)
        if index is None:
            raise HTTPException(422, "Unknown section to insert after")
    section = DocSection(document_id=document.id, key=key, title=title, position=index)
    db.add(section)
    sections.insert(index, section)
    _renumber(sections)
    db.flush()
    _emit_document(db, team, document, user.id, {"action": "section_added", "key": key, "title": title})
    db.commit()
    return section_dict(section)


@router.post("/api/sections/{section_id}/move")
def move_section(section_id: str, body: SectionMove, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    sections = _ordered(db, section.document_id)
    index = next(i for i, item in enumerate(sections) if item.id == section.id)
    target = index - 1 if body.direction == "up" else index + 1
    if not 0 <= target < len(sections):
        raise HTTPException(422, f"This section is already {'first' if body.direction == 'up' else 'last'}")
    sections[index], sections[target] = sections[target], sections[index]
    _renumber(sections)
    document = db.get(TeamDocument, section.document_id)
    payload = _emit_document(db, team, document, user.id, {"action": "section_moved", "key": section.key, "title": section.title})
    db.commit()
    return payload


@router.delete("/api/sections/{section_id}")
def delete_section(section_id: str, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    if lock_active(section, now()) and section.lock_user_id != user.id:
        raise HTTPException(409, "Someone is editing this section right now")
    sections = _ordered(db, section.document_id)
    if len(sections) == 1:
        raise HTTPException(422, "A document needs at least one section")
    key, title = section.key, section.title
    db.delete(section)
    sections = [item for item in sections if item.id != section.id]
    _renumber(sections)
    db.flush()
    document = db.get(TeamDocument, section.document_id)
    payload = _emit_document(db, team, document, user.id, {"action": "section_deleted", "key": key, "title": title})
    db.commit()
    return payload


@router.post("/api/sections/{section_id}/lock")
def lock_section(section_id: str, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    at = now()
    active = lock_active(section, at)
    if active and section.lock_user_id != user.id:
        raise HTTPException(409, "Someone else is editing this section")
    section.lock_user_id = user.id
    section.lock_expires_at = at + timedelta(seconds=LOCK_SECONDS)
    # Heartbeats emit too: teammates only learn the extended expiry from this
    # event, and would otherwise see a live lock as released after 90 s.
    emit(db, team.id, "section.locked", user.id, {"id": section.id, "lock_user_id": user.id, "lock_expires_at": iso(section.lock_expires_at)})
    db.commit()
    return section_dict(section)


@router.post("/api/sections/{section_id}/unlock")
def unlock_section(section_id: str, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    if not lock_active(section, now()):
        return section_dict(section)
    if section.lock_user_id != user.id:
        raise HTTPException(403, "Only the person editing can release this lock")
    section.lock_user_id = None
    section.lock_expires_at = None
    emit(db, team.id, "section.unlocked", user.id, {"id": section.id})
    db.commit()
    return section_dict(section)


@router.put("/api/sections/{section_id}/content")
def save_section(section_id: str, body: SectionContent, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    at = now()
    if not (lock_active(section, at) and section.lock_user_id == user.id):
        raise HTTPException(409, "Open the section for editing first")
    if body.version != section.version:
        raise HTTPException(409, "Someone saved a newer version; reload the section")
    section.content_md = body.content_md
    section.version += 1
    section.status = "accepted" if body.content_md.strip() else "empty"
    section.lock_expires_at = at + timedelta(seconds=LOCK_SECONDS)
    emit(db, team.id, "section.updated", user.id, section_dict(section))
    db.commit()
    return section_dict(section)
