"""A readable log of important team actions, derived from the event log (no new data).
Chat events never appear, so instructors can read it too."""
from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import CurrentUser, User
from .common import Db, iso, loads, require_team
from .models import Team, TeamEvent
from .policy import authorize

router = APIRouter()
STATUS_LABEL = {"todo": "To do", "doing": "Doing", "review": "Review", "done": "Done"}


def _describe(event: TeamEvent, payload: dict, tasks: dict[str, dict], name) -> str | None:
    """One line for an important event, or None to leave it out. `tasks` holds each task's
    last known title and assignee, so reassignments can say from whom to whom."""
    kind = event.type
    task_id = str(payload.get("id", ""))
    known = tasks.get(task_id, {})
    title = payload.get("title") or known.get("title") or "a task"
    if kind == "task.created":
        by_hermes = " (from a Hermes proposal)" if payload.get("created_by") == "hermes" else ""
        owner = f" for {name(payload.get('assignee_id'))}" if payload.get("assignee_id") else ""
        return f"added task “{title}”{owner}{by_hermes}"
    if kind == "task.updated":
        if payload.get("assignee_id") != known.get("assignee_id"):
            before = name(known.get("assignee_id")) if known.get("assignee_id") else "nobody"
            after = name(payload.get("assignee_id")) if payload.get("assignee_id") else "nobody"
            return f"reassigned “{title}” from {before} to {after}"
        if known.get("title") and payload.get("title") != known.get("title"):
            return f"renamed “{known['title']}” to “{payload.get('title')}”"
        return None
    if kind == "task.moved":
        return f"moved “{title}” to {STATUS_LABEL.get(str(payload.get('status')), payload.get('status'))}"
    if kind == "task.deleted":
        return f"deleted task “{title}”"
    if kind == "milestone.created":
        return f"added milestone “{payload.get('title')}”"
    if kind == "milestone.completed":
        return f"completed milestone “{payload.get('title')}”"
    if kind == "member.joined":
        return "joined the team"
    if kind == "invite.created":
        return f"invited {name(payload.get('invited_user_id'))}"
    if kind in {"proposal.applied", "proposal.rejected"}:
        verb = "applied" if kind.endswith("applied") else "rejected"
        return f"{verb} a Hermes proposal: {payload.get('summary', '')}"
    if kind == "decision.pinned":
        return f"pinned a decision: {str(payload.get('text', ''))[:140]}"
    if kind == "decision.removed":
        return "unpinned a decision"
    if kind == "document.created":
        return f"created the document “{payload.get('title')}”"
    if kind == "document.updated":
        change = payload.get("change") or {}
        document = (payload.get("document") or {}).get("title", "a document")
        action = change.get("action")
        if action == "renamed":
            return f"renamed a document to “{change.get('title')}”"
        section = f"{change.get('key')} {change.get('title')}"
        if action == "section_added":
            return f"added section {section} to {document}"
        if action == "section_deleted":
            return f"deleted section {section} from {document}"
        if action == "section_moved":
            return f"reordered section {section} in {document}"
        return None
    if kind == "team.updated" and "name" in payload:
        return f"set the team to “{payload.get('name')}”, {payload.get('size_limit')} members"
    if kind == "team.updated" and "charter" in payload:
        return "updated the team charter"
    return None


def team_activity(db: Session, team: Team, *, limit: int = 50, before: int | None = None) -> dict:
    names: dict[str, str] = {}

    def name(user_id: str | None) -> str:
        if not user_id:
            return "Hermes"
        if user_id not in names:
            user = db.get(User, user_id)
            names[user_id] = user.display_name if user else "A classmate"
        return names[user_id]

    tasks: dict[str, dict] = {}
    entries: list[dict] = []
    for event in db.scalars(select(TeamEvent).where(TeamEvent.team_id == team.id).order_by(TeamEvent.seq)).all():
        payload = loads(event.payload_json, {})
        text = _describe(event, payload, tasks, name)
        if event.type in {"task.created", "task.updated"}:
            tasks[str(payload.get("id"))] = {"title": payload.get("title"), "assignee_id": payload.get("assignee_id")}
        if text and (before is None or event.seq < before):
            entries.append({"seq": event.seq, "at": iso(event.created_at), "actor_user_id": event.actor_user_id,
                            "actor": name(event.actor_user_id), "kind": event.type, "text": text})
    entries.reverse()
    page = entries[:limit]
    return {"entries": page, "next_before": page[-1]["seq"] if len(entries) > limit else None}


@router.get("/v1/teams/{team_id}/activity")
def get_activity(team_id: str, db: Db, user: CurrentUser, limit: int = Query(default=50, ge=1, le=200), before: int | None = None) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "view")
    return team_activity(db, team, limit=limit, before=before)
