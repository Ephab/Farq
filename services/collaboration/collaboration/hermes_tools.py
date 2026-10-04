"""The central team toolset: read one team's shared state, create proposals. Nothing else.

Every call needs the service tool token (held by the team gateway's plugin) AND the grant of one running
run: it names the team, the run and the member who invoked it. The actor always comes from the grant,
never from an id the model supplies, is re-authorized on every call (so removal, archive or account
disable stops a run mid-flight), and a run has no fallback identity when run_id is missing.
"""
import hashlib
import hmac
import json

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .identity import User
from .models import now
from .teams.chat import decision_dict
from .teams.common import Db, require_team
from .teams.docs import section_dict
from .teams.models import Decision, DocSection, Milestone, Task, Team, TeamAgentRun, TeamDocument, TeamMember, TeamMessage, TeamProposal, TeamRunGrant
from .teams.policy import authorize
from .teams.proposals import ProposalError, create_proposal, expire_stalled, proposal_dict
from .teams.tasks import milestone_dict, task_dict
from .teams.teams import team_dict
from .team_hermes import digest_token

router = APIRouter()
CHAT_WINDOW = 50
ID = r"^[A-Za-z0-9_-]{1,64}$"


def service_token_ok(request: Request, presented: str | None) -> bool:
    expected = request.app.state.settings.hermes_tool_token
    return bool(expected and presented and hmac.compare_digest(
        hashlib.sha256(presented.encode()).digest(), hashlib.sha256(expected.get_secret_value().encode()).digest()))


def run_actor(request: Request, db: Session, team_id: str, run_id: str, service_token: str | None, grant_token: str | None) -> tuple[Team, User]:
    if not request.app.state.settings.team_ai_enabled or not service_token_ok(request, service_token):
        raise HTTPException(403, "Team Hermes tools are not available")
    grant = db.get(TeamRunGrant, digest_token(grant_token)) if grant_token else None
    if grant is None or grant.expires_at <= now() or grant.run_id != run_id or grant.team_id != team_id:
        raise HTTPException(403, "This tool needs the grant from the current run header")
    run = db.get(TeamAgentRun, run_id)
    user = db.get(User, grant.actor_id)
    if run is None or run.status != "running" or run.team_id != team_id or user is None or user.disabled:
        raise HTTPException(403, "This Hermes run is not active for this team")
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    return team, user


def team_context(db: Session, team: Team, user: User) -> dict:
    """Shared project state only: no profiles, facts, roadmaps or anything from a personal database."""
    role = authorize(db, user, team, "write")
    expire_stalled(db, team)
    shown = team_dict(db, team, role)
    names = {member["user_id"]: member["display_name"] for member in shown["members"]}
    documents = []
    for document in db.scalars(select(TeamDocument).where(TeamDocument.team_id == team.id).order_by(TeamDocument.created_at)).all():
        sections = db.scalars(select(DocSection).where(DocSection.document_id == document.id).order_by(DocSection.position)).all()
        documents.append({"id": document.id, "kind": document.kind, "title": document.title,
                          "sections": [{"id": s.id, "key": s.key, "title": s.title, "owner_user_id": s.owner_user_id, "status": s.status} for s in sections]})
    rows = db.scalars(select(TeamMessage).where(
        TeamMessage.team_id == team.id, TeamMessage.deleted_at.is_(None),
        (TeamMessage.visible_to_user_id.is_(None)) | (TeamMessage.visible_to_user_id == user.id),
    ).order_by(TeamMessage.created_at.desc()).limit(CHAT_WINDOW)).all()[::-1]
    return {
        "acting_user": {"id": user.id, "display_name": user.display_name, "role": role},
        "team": shown,
        "teammates": [{"user_id": member["user_id"], "display_name": member["display_name"], "role_label": member["role_label"],
                       "facts": [], "roadmap": None} for member in shown["members"]],
        "tasks": [task_dict(task) for task in db.scalars(select(Task).where(Task.team_id == team.id).order_by(Task.status, Task.position)).all()],
        "milestones": [milestone_dict(item) for item in db.scalars(select(Milestone).where(Milestone.team_id == team.id)).all()],
        "decisions": [decision_dict(item) for item in db.scalars(select(Decision).where(Decision.team_id == team.id)).all()],
        "documents": documents,
        "open_proposals": [proposal_dict(item) for item in db.scalars(select(TeamProposal).where(
            TeamProposal.team_id == team.id, TeamProposal.status.in_(("pending", "awaiting_lead")))).all()],
        "untrusted_messages": [{"id": row.id, "author": names.get(row.author_user_id, "Hermes") if row.author_user_id else "Hermes",
                                "kind": row.kind, "content": row.content} for row in rows],
    }


@router.get("/internal/hermes/teams/{team_id}/context")
def context(team_id: str, request: Request, db: Db, run_id: str,
            x_waypoint_internal_token: str | None = Header(default=None), x_waypoint_grant: str | None = Header(default=None)):
    team, user = run_actor(request, db, team_id, run_id, x_waypoint_internal_token, x_waypoint_grant)
    result = team_context(db, team, user)
    db.commit()
    return result


@router.get("/internal/hermes/tasks/{task_id}")
def task(task_id: str, request: Request, db: Db, run_id: str,
         x_waypoint_internal_token: str | None = Header(default=None), x_waypoint_grant: str | None = Header(default=None)):
    item = db.get(Task, task_id)
    if item is None:
        raise HTTPException(404, "Task not found")
    run_actor(request, db, item.team_id, run_id, x_waypoint_internal_token, x_waypoint_grant)
    return task_dict(item)


@router.get("/internal/hermes/sections/{section_id}")
def section(section_id: str, request: Request, db: Db, run_id: str,
            x_waypoint_internal_token: str | None = Header(default=None), x_waypoint_grant: str | None = Header(default=None)):
    item = db.get(DocSection, section_id)
    document = db.get(TeamDocument, item.document_id) if item else None
    if item is None or document is None:
        raise HTTPException(404, "Section not found")
    run_actor(request, db, document.team_id, run_id, x_waypoint_internal_token, x_waypoint_grant)
    return {**section_dict(item), "document_kind": document.kind, "document_title": document.title}


class ProposalInput(BaseModel):
    run_id: str = Field(pattern=ID)
    kind: str = Field(max_length=24)
    payload: dict
    summary: str = Field(default="", max_length=240)


@router.post("/internal/hermes/teams/{team_id}/proposals", status_code=201)
def propose(team_id: str, body: ProposalInput, request: Request, db: Db,
            x_waypoint_internal_token: str | None = Header(default=None), x_waypoint_grant: str | None = Header(default=None)):
    team, user = run_actor(request, db, team_id, body.run_id, x_waypoint_internal_token, x_waypoint_grant)
    key = hashlib.sha256(json.dumps([body.kind, body.payload, body.summary], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    existing = db.scalar(select(TeamProposal).where(TeamProposal.run_id == body.run_id, TeamProposal.request_key == key))
    if existing is not None:
        return {"success": True, "proposal": proposal_dict(existing), "note": "Already proposed in this run. Waiting for the team."}
    made = db.scalar(select(func.count()).select_from(TeamProposal).where(TeamProposal.run_id == body.run_id))
    if made >= request.app.state.settings.proposals_per_run:
        raise HTTPException(429, "This run has reached its proposal limit; tell the team what is left")
    try:
        proposal = create_proposal(db, team, body.kind, body.payload, summary=body.summary, invoked_by=user.id, run_id=body.run_id)
    except ProposalError as error:
        raise HTTPException(422, str(error)) from error
    proposal.request_key = key
    db.commit()
    return {"success": True, "proposal": proposal_dict(proposal), "note": "Waiting for the team. Nothing has changed yet."}
