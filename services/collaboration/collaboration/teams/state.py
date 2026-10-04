from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import func, select

from ..identity import CurrentUser, User
from .chat import decision_dict, message_dict, reactions_for, votes_for
from .common import Db, require_team
from .docs import document_dict
from .models import Decision, DocSection, Milestone, Task, TeamDocument, TeamEvent, TeamMember, TeamMessage, TeamProposal
from .policy import authorize, is_member
from .proposals import expire_stalled, proposal_dict
from .tasks import milestone_dict, task_dict
from .teams import team_dict

router = APIRouter()
MESSAGE_WINDOW = 200


@router.get("/v1/teams/{team_id}/state")
def team_state(team_id: str, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    expire_stalled(db, team)
    db.commit()
    # Read the cursor first: anything written after this point arrives on the stream.
    last_seq = db.scalar(select(func.max(TeamEvent.seq)).where(TeamEvent.team_id == team.id)) or 0
    tasks = db.scalars(select(Task).where(Task.team_id == team.id).order_by(Task.status, Task.position)).all()
    milestones = db.scalars(
        select(Milestone).where(Milestone.team_id == team.id).order_by(Milestone.due.is_(None), Milestone.due, Milestone.created_at)
    ).all()
    decisions = db.scalars(select(Decision).where(Decision.team_id == team.id).order_by(Decision.created_at.desc())).all()
    documents = []
    for document in db.scalars(select(TeamDocument).where(TeamDocument.team_id == team.id).order_by(TeamDocument.created_at)).all():
        sections = db.scalars(select(DocSection).where(DocSection.document_id == document.id).order_by(DocSection.position)).all()
        documents.append(document_dict(document, sections))
    messages, last_seen = None, None
    if is_member(role):
        rows = db.scalars(
            select(TeamMessage).where(
                TeamMessage.team_id == team.id,
                (TeamMessage.visible_to_user_id.is_(None)) | (TeamMessage.visible_to_user_id == user.id),
            ).order_by(TeamMessage.created_at.desc()).limit(MESSAGE_WINDOW)
        ).all()[::-1]
        reactions = reactions_for(db, [row.id for row in rows])
        votes = votes_for(db, [row.id for row in rows if row.kind == "poll"])
        messages = [message_dict(row, reactions.get(row.id), votes.get(row.id)) for row in rows]
        last_seen = db.scalar(select(TeamMember.last_seen_seq).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
    proposals = db.scalars(select(TeamProposal).where(TeamProposal.team_id == team.id).order_by(TeamProposal.created_at.desc()).limit(50)).all()
    return {
        "team": team_dict(db, team, role), "tasks": [task_dict(item) for item in tasks],
        "milestones": [milestone_dict(item) for item in milestones], "decisions": [decision_dict(item) for item in decisions],
        "documents": documents, "messages": messages, "proposals": [proposal_dict(item) for item in proposals],
        "imports": [], "last_seq": last_seq, "last_seen_seq": last_seen,
    }


@router.get("/v1/teams/{team_id}/contribution")
def team_contribution(team_id: str, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    rows = []
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team.id).order_by(TeamMember.joined_at)).all():
        tasks = db.scalars(select(Task).where(Task.team_id == team.id, Task.assignee_id == member.user_id)).all()
        done = [task for task in tasks if task.status == "done"]
        messages = None
        if is_member(role):
            messages = db.scalar(select(func.count()).select_from(TeamMessage).where(
                TeamMessage.team_id == team.id, TeamMessage.author_user_id == member.user_id,
                TeamMessage.deleted_at.is_(None), TeamMessage.visible_to_user_id.is_(None),
            ))
        person = db.get(User, member.user_id)
        rows.append({
            "user_id": member.user_id, "display_name": person.display_name if person else member.user_id,
            "done_points": sum(task.estimate_points for task in done), "done_tasks": len(done),
            "open_points": sum(task.estimate_points for task in tasks if task.status != "done"), "messages": messages,
        })
    return {"members": rows}
