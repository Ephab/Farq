"""Rebuild the seeded demo team (Group 1) from `seed.py`, leaving every other team alone."""
from __future__ import annotations

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .common import Db
from .models import (
    Decision, DocSection, MessageReaction, Milestone, PollVote, Task, Team, TeamAgentRun, TeamDocument, TeamEvent,
    TeamInvite, TeamMember, TeamMessage, TeamProposal,
)
from .seed import DEMO_TEAM_ID, DEMO_TEAM_LEAD, seed_teams

router = APIRouter()


class TeamResetInput(BaseModel):
    confirm: Literal["RESET"]


def reset_demo_team(db: Session) -> None:
    # Runs left "running" by a crash would block forever, so only recent ones count as busy.
    recent = now() - timedelta(minutes=10)
    busy = select(TeamAgentRun.id).where(
        TeamAgentRun.team_id == DEMO_TEAM_ID, TeamAgentRun.status.in_(("queued", "running")), TeamAgentRun.created_at >= recent,
    )
    if db.scalar(busy.limit(1)):
        raise HTTPException(409, "Hermes is still working in this team; wait for it to finish before resetting")
    message_ids = select(TeamMessage.id).where(TeamMessage.team_id == DEMO_TEAM_ID)
    document_ids = select(TeamDocument.id).where(TeamDocument.team_id == DEMO_TEAM_ID)
    db.execute(delete(MessageReaction).where(MessageReaction.message_id.in_(message_ids)))
    db.execute(delete(PollVote).where(PollVote.message_id.in_(message_ids)))
    db.execute(delete(DocSection).where(DocSection.document_id.in_(document_ids)))
    for model in (TeamMessage, Decision, TeamDocument, Task, Milestone, TeamProposal, TeamAgentRun, TeamInvite, TeamEvent, TeamMember):
        db.execute(delete(model).where(model.team_id == DEMO_TEAM_ID))
    db.execute(delete(Team).where(Team.id == DEMO_TEAM_ID))
    db.commit()
    seed_teams(db)


@router.post("/api/demo/reset-team")
def reset_team(_body: TeamResetInput, db: Db, user: CurrentUser) -> dict:
    # Destructive for the whole team, so only its lead may do it (the seeded lead if it was deleted).
    team = db.get(Team, DEMO_TEAM_ID)
    if user.id != (team.lead_user_id if team else DEMO_TEAM_LEAD):
        raise HTTPException(403, "Only the Group 1 lead can reset the demo team")
    reset_demo_team(db)
    return {"team_id": DEMO_TEAM_ID}
