"""Move a local team to the shared collaboration service, once, on the lead's explicit confirmation.

Dry run (the default) builds the bundle and asks the service to validate and count it; nothing is stored.
A real move needs `confirm: true` as well. Afterwards this machine's copy is frozen: it stays readable but
every write is refused (`policy.authorize`), so the two copies can never diverge ("no dual writes"). Chat,
reactions, polls, proposals, Hermes runs and events are not sent, and no student facts or roadmaps ever are.
Reopening the local copy is a deliberate, local-only step (`scripts/legacy_cutover.py`).
"""
from __future__ import annotations

import re

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from .. import collab_coach
from .common import Db, iso, loads, require_team
from .models import Assignment, Decision, DocSection, Milestone, Task, TeamCutover, TeamDocument, TeamMember
from .policy import authorize
from ..identity import CurrentUser, User

router = APIRouter()
BUNDLE_VERSION = 1
CLIENT_VERSION = "0.1.0"
ALREADY_MOVED = re.compile(r"already moved \(shared project ([0-9a-f-]{36})\)")


class MoveInput(BaseModel):
    dry_run: bool = True
    confirm: bool = False


def build_bundle(db, team, user) -> dict:
    members = db.scalars(select(TeamMember).where(TeamMember.team_id == team.id).order_by(TeamMember.joined_at)).all()
    assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
    own = {"brief": loads(team.brief_json, {}), "deliverables": loads(team.deliverables_json, []), "rubric": loads(team.rubric_json, [])}
    # A team without its own project keeps the assignment's brief, since the shared room has no assignment.
    fallback = {"brief": loads(assignment.brief_json, {}), "deliverables": loads(assignment.deliverables_json, []),
                "rubric": loads(assignment.rubric_json, [])} if assignment else {}
    project = {key: own[key] or fallback.get(key, own[key]) for key in own}
    documents = []
    for document in db.scalars(select(TeamDocument).where(TeamDocument.team_id == team.id).order_by(TeamDocument.created_at)).all():
        sections = db.scalars(select(DocSection).where(DocSection.document_id == document.id).order_by(DocSection.position)).all()
        documents.append({"id": document.id, "kind": document.kind, "title": document.title, "sections": [
            {"id": s.id, "key": s.key, "title": s.title, "position": s.position, "owner_local_id": s.owner_user_id,
             "content_md": s.content_md, "status": s.status} for s in sections]})
    return {
        "version": BUNDLE_VERSION, "source_team_id": team.id, "name": team.name, "charter": {}, "assignment_override": loads(team.assignment_override_json, {}), "project": project,
        "members": [{"local_user_id": m.user_id, "display_name": (db.get(User, m.user_id).display_name if db.get(User, m.user_id) else "Teammate"),
                     "is_lead": m.user_id == team.lead_user_id} for m in members],
        "milestones": [{"id": m.id, "title": m.title, "due": iso(m.due), "deliverable_key": m.deliverable_key, "completed_at": iso(m.completed_at)}
                       for m in db.scalars(select(Milestone).where(Milestone.team_id == team.id)).all()],
        "tasks": [{"id": t.id, "title": t.title, "description": t.description, "status": t.status, "assignee_local_id": t.assignee_id,
                   "estimate_points": t.estimate_points, "due": iso(t.due), "depends_on": loads(t.depends_on_json, []),
                   "milestone_id": t.milestone_id, "rationale": t.rationale, "position": t.position}
                  for t in db.scalars(select(Task).where(Task.team_id == team.id).order_by(Task.position)).all()],
        "decisions": [{"id": d.id, "text": d.text} for d in db.scalars(select(Decision).where(Decision.team_id == team.id)).all()],
        "documents": documents,
    }


# Under the sign-in prefix on purpose: the broker session cookie is only sent to /api/collaboration/auth.
@router.post("/api/collaboration/auth/teams/{team_id}/move")
def move_to_shared(team_id: str, body: MoveInput, request: Request, response: Response, db: Db, user: CurrentUser):
    team = require_team(db, team_id)
    moved = db.get(TeamCutover, team.id)
    if moved is not None:
        raise HTTPException(409, f"This team already moved to the shared service (project {moved.central_team_id})")
    authorize(db, user, team, "lead")
    if not body.dry_run and not body.confirm:
        raise HTTPException(422, "Confirm the move: this team becomes read-only on this computer")
    broker, session = collab_coach.session_context(request, response)
    try:
        signed_in = broker.token(session)
    except Exception:
        raise HTTPException(503, "Could not check collaboration sign-in") from None
    if signed_in is None:
        raise HTTPException(401, "Sign in to collaboration first")
    payload = {"bundle": build_bundle(db, team, user), "importer_local_id": user.id, "dry_run": body.dry_run}
    try:
        answer = httpx.post(broker.config.api_origin + "/v1/teams/import", json=payload, timeout=60, follow_redirects=False,
                            headers={"Authorization": f"Bearer {signed_in['access_token']}", "X-Waypoint-Client-Version": CLIENT_VERSION})
    except httpx.HTTPError:
        raise HTTPException(503, "The collaboration service is unavailable right now") from None
    data = answer.json() if answer.headers.get("content-type", "").startswith("application/json") else {}
    detail = data.get("detail") if isinstance(data, dict) else None
    central_id = None
    if answer.status_code == 409 and isinstance(detail, str) and (found := ALREADY_MOVED.search(detail)) and not body.dry_run:
        central_id = found.group(1)  # an earlier attempt succeeded centrally but not here: finish the freeze
    elif answer.status_code >= 400:
        if answer.status_code == 422 and isinstance(detail, list) and detail and isinstance(detail[0], dict):
            where = ".".join(str(part) for part in detail[0].get("loc", [])[1:5])
            raise HTTPException(422, f"The team data did not pass the shared service's checks ({where}: {str(detail[0].get('msg', ''))[:120]})")
        if answer.status_code in {401, 409, 422, 426, 429} and isinstance(detail, str):
            raise HTTPException(answer.status_code, detail[:300])
        raise HTTPException(502, "The collaboration service could not complete the move")
    elif not body.dry_run:
        central_id = data["team_id"]
    if central_id:
        db.add(TeamCutover(team_id=team.id, central_team_id=central_id, central_origin=broker.config.api_origin))
        db.commit()
        data = {**(data if isinstance(data, dict) else {}), "team_id": central_id}
    return {"dry_run": body.dry_run, "moved": bool(central_id), "shared_team_id": central_id, "summary": data}
