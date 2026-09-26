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
    title: str | None = Field(default=None, min_length=1, max_length=160)
    owner_user_id: str | None = None


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


@router.post("/api/teams/{team_id}/documents", status_code=201)
def create_document(team_id: str, body: DocumentCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    if body.sections:
        specs = [(item.key.strip(), item.title.strip()) for item in body.sections]
    elif body.kind in OUTLINES:
        specs = OUTLINES[body.kind][1]
    else:
        raise HTTPException(422, "A custom document needs at least one section")
    if len({key for key, _ in specs}) != len(specs):
        raise HTTPException(422, "Section keys must be unique")
    default_title = OUTLINES[body.kind][0] if body.kind in OUTLINES else "Document"
    document = TeamDocument(team_id=team.id, kind=body.kind, title=(body.title or "").strip() or default_title)
    db.add(document)
    db.flush()
    sections = [DocSection(document_id=document.id, key=key, title=title, position=index) for index, (key, title) in enumerate(specs)]
    db.add_all(sections)
    db.flush()
    payload = document_dict(document, sections)
    emit(db, team.id, "document.created", user.id, payload)
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
    if body.title is not None:
        section.title = body.title.strip() or section.title
    emit(db, team.id, "section.updated", user.id, section_dict(section))
    db.commit()
    return section_dict(section)


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
