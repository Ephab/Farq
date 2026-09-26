from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import User, resolve_user
from ..models import RoadmapVersion, StudentFact, StudentProfile
from .common import Db, loads, require, require_team
from .chat import decision_dict
from .docs import section_dict
from .models import Decision, DocSection, TeamAgentRun, Milestone, Task, Team, TeamDocument, TeamMember, TeamMessage, TeamProposal
from .policy import authorize, is_member
from .proposals import ProposalError, create_proposal, expire_stalled, proposal_dict
from .tasks import milestone_dict, task_dict
from .teams import team_dict

INTERNAL_TOKEN = os.getenv("FARQ_INTERNAL_TOKEN", "farq-internal-dev")
CARD_CATEGORIES = ("skill", "goal", "strength", "interest")
CHAT_WINDOW = 50
router = APIRouter()


def require_internal(x_farq_internal_token: Annotated[str | None, Header()] = None) -> None:
    if x_farq_internal_token != INTERNAL_TOKEN:
        raise HTTPException(401, "Invalid internal token")


INTERNAL = [Depends(require_internal)]


class ProposalInput(BaseModel):
    run_id: str | None = None
    kind: str
    payload: dict
    summary: str = Field(default="", max_length=240)


def _run_actor(db: Session, run_id: str | None, team_id: str) -> User:
    """Hermes acts as the member who started this run, never as a user id the
    model names: chat text could otherwise steer it into another member's view.
    Models sometimes omit run_id; runs are one at a time per team, so the
    team's running run is then unambiguous."""
    if run_id:
        run = db.get(TeamAgentRun, run_id)
    else:
        run = db.scalar(select(TeamAgentRun).where(TeamAgentRun.team_id == team_id, TeamAgentRun.status == "running")
                        .order_by(TeamAgentRun.created_at.desc()))
    if run is None or run.status != "running" or run.team_id != team_id:
        raise HTTPException(403, "This Hermes run is not active for this team")
    user = resolve_user(db, run.invoked_by_user_id)
    if user is None:
        raise HTTPException(404, "Unknown acting user")
    return user


def roadmap_summary(db: Session, student_id: str) -> dict | None:
    version = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    if version is None:
        return None
    snapshot = loads(version.snapshot_json, {})
    nodes = {node["id"]: node for node in snapshot.get("nodes", [])}
    stages = snapshot.get("stages", [])

    def open_titles(stage: dict) -> list[str]:
        return [nodes[node_id]["title"] for node_id in stage.get("nodeIds", []) if node_id in nodes and nodes[node_id].get("status") != "done"]

    current = next((index for index, stage in enumerate(stages) if open_titles(stage)), None)
    if current is None:
        return {"title": snapshot.get("title", ""), "current_stage": None, "next_stage": None, "open_nodes": []}
    return {
        "title": snapshot.get("title", ""), "current_stage": stages[current]["title"],
        "next_stage": stages[current + 1]["title"] if current + 1 < len(stages) else None,
        "open_nodes": open_titles(stages[current])[:5],
    }


def teammate_card(db: Session, user_id: str) -> dict:
    """What Hermes may know about a teammate: stated facts and roadmap position, never raw evidence."""
    user = db.get(User, user_id)
    card = {"user_id": user_id, "display_name": user.display_name if user else user_id, "program": "", "year": "", "facts": [], "roadmap": None}
    if user is None or user.student_id is None:
        return card
    profile = db.get(StudentProfile, user.student_id)
    if profile is not None:
        card["program"], card["year"] = profile.program, profile.year_label
    facts = db.scalars(select(StudentFact).where(
        StudentFact.student_id == user.student_id, StudentFact.active.is_(True), StudentFact.category.in_(CARD_CATEGORIES),
    ).order_by(StudentFact.created_at).limit(20)).all()
    card["facts"] = [{"category": fact.category, "key": fact.key, "value": loads(fact.value_json, fact.key)} for fact in facts]
    card["roadmap"] = roadmap_summary(db, user.student_id)
    return card


def team_context(db: Session, team: Team, user: User) -> dict:
    role = authorize(db, user, team, "view")
    expire_stalled(db, team)
    members = db.scalars(select(TeamMember).where(TeamMember.team_id == team.id).order_by(TeamMember.joined_at)).all()
    documents = []
    for document in db.scalars(select(TeamDocument).where(TeamDocument.team_id == team.id).order_by(TeamDocument.created_at)).all():
        sections = db.scalars(select(DocSection).where(DocSection.document_id == document.id).order_by(DocSection.position)).all()
        documents.append({
            "id": document.id, "kind": document.kind, "title": document.title,
            "sections": [{"id": s.id, "key": s.key, "title": s.title, "owner_user_id": s.owner_user_id, "status": s.status} for s in sections],
        })
    context = {
        "acting_user": {"id": user.id, "display_name": user.display_name, "role": role},
        "team": team_dict(db, team, role),
        "teammates": [teammate_card(db, member.user_id) for member in members],
        "tasks": [task_dict(task) for task in db.scalars(select(Task).where(Task.team_id == team.id).order_by(Task.status, Task.position)).all()],
        "milestones": [milestone_dict(item) for item in db.scalars(select(Milestone).where(Milestone.team_id == team.id)).all()],
        "decisions": [decision_dict(item) for item in db.scalars(select(Decision).where(Decision.team_id == team.id)).all()],
        "documents": documents,
        "open_proposals": [proposal_dict(item) for item in db.scalars(select(TeamProposal).where(
            TeamProposal.team_id == team.id, TeamProposal.status.in_(("pending", "awaiting_lead")),
        )).all()],
    }
    if is_member(role):
        names = {card["user_id"]: card["display_name"] for card in context["teammates"]}
        rows = db.scalars(select(TeamMessage).where(
            TeamMessage.team_id == team.id, TeamMessage.deleted_at.is_(None),
            (TeamMessage.visible_to_user_id.is_(None)) | (TeamMessage.visible_to_user_id == user.id),
        ).order_by(TeamMessage.created_at.desc()).limit(CHAT_WINDOW)).all()[::-1]
        context["messages"] = [
            {"id": row.id, "author": names.get(row.author_user_id, "Hermes") if row.author_user_id else "Hermes", "kind": row.kind, "content": row.content}
            for row in rows
        ]
    return context


@router.get("/internal/hermes/teams/{team_id}/context", dependencies=INTERNAL)
def internal_team_context(team_id: str, db: Db, run_id: str | None = None) -> dict:
    user = _run_actor(db, run_id, team_id)
    context = team_context(db, require_team(db, team_id), user)
    db.commit()
    return context


@router.get("/internal/hermes/tasks/{task_id}", dependencies=INTERNAL)
def internal_task(task_id: str, db: Db, run_id: str | None = None) -> dict:
    task = require(db, Task, task_id, "Task")
    user = _run_actor(db, run_id, task.team_id)
    authorize(db, user, require_team(db, task.team_id), "view")
    return task_dict(task)


@router.get("/internal/hermes/sections/{section_id}", dependencies=INTERNAL)
def internal_section(section_id: str, db: Db, run_id: str | None = None) -> dict:
    section = require(db, DocSection, section_id, "Section")
    document = db.get(TeamDocument, section.document_id)
    user = _run_actor(db, run_id, document.team_id)
    authorize(db, user, require_team(db, document.team_id), "view")
    return {**section_dict(section), "document_kind": document.kind, "document_title": document.title}


@router.post("/internal/hermes/teams/{team_id}/proposals", dependencies=INTERNAL, status_code=201)
def internal_propose(team_id: str, body: ProposalInput, db: Db) -> dict:
    team = require_team(db, team_id)
    user = _run_actor(db, body.run_id, team.id)
    authorize(db, user, team, "write")
    try:
        proposal = create_proposal(db, team, body.kind, body.payload, summary=body.summary, invoked_by=user.id, run_id=body.run_id)
    except ProposalError as error:
        raise HTTPException(422, str(error)) from error
    db.commit()
    return {"success": True, "proposal": proposal_dict(proposal), "note": "Waiting for the team. Nothing has changed yet."}
