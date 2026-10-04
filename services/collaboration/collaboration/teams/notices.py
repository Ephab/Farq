"""Deterministic team risks (no model): deadline pace, blocked work and quiet
members. Posted as templated notices at most once per risk per UTC day."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .chat import post_message
from .common import Db, aware, loads, require_team
from .models import Assignment, Task, Team, TeamEvent, TeamMember, TeamMessage
from .policy import authorize, is_member

BLOCKED_DAYS = 3
QUIET_DAYS = 7
VELOCITY_DAYS = 7
NO_VELOCITY_WARNING_DAYS = 14
DAILY_TEAM_NOTICES = 3
router = APIRouter()


@dataclass(frozen=True)
class Risk:
    key: str
    kind: str
    text: str
    # Set: private to that member (never shown to instructors).
    user_id: str | None = None


def assess(db: Session, team: Team, at: datetime | None = None) -> list[Risk]:
    at = at or now()
    risks: list[Risk] = []
    tasks = db.scalars(select(Task).where(Task.team_id == team.id)).all()
    by_id = {task.id: task for task in tasks}
    events = db.scalars(select(TeamEvent).where(TeamEvent.team_id == team.id).order_by(TeamEvent.seq)).all()

    remaining = sum(task.estimate_points for task in tasks if task.status != "done")
    window_start = at - timedelta(days=VELOCITY_DAYS)
    finished = {
        loads(event.payload_json, {}).get("id") for event in events
        if event.type == "task.moved" and aware(event.created_at) >= window_start and loads(event.payload_json, {}).get("status") == "done"
    }
    velocity = sum(by_id[task_id].estimate_points for task_id in finished if task_id in by_id and by_id[task_id].status == "done") / VELOCITY_DAYS
    assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
    deadline = aware(assignment.deadline) if assignment and assignment.deadline else None
    if deadline and remaining:
        days_left = max(0, (deadline - at).days)
        need = remaining / velocity if velocity else None
        if need is None and days_left <= NO_VELOCITY_WARNING_DAYS:
            risks.append(Risk("deadline", "deadline", f"Deadline risk: no tasks were finished in the last week and {remaining} points remain, with {days_left} days left."))
        elif need is not None and need > days_left:
            risks.append(Risk("deadline", "deadline", f"Deadline risk: at {velocity:.1f} points a day the remaining {remaining} points need about {round(need)} days, with {days_left} days left."))

    last_touch: dict[str, datetime] = {}
    last_active: dict[str, datetime] = {}
    for event in events:
        if event.type.startswith("task."):
            task_id = loads(event.payload_json, {}).get("id")
            if task_id:
                last_touch[task_id] = aware(event.created_at)
        if event.actor_user_id:
            last_active[event.actor_user_id] = aware(event.created_at)
    for task in tasks:
        if task.status == "doing":
            days = (at - (last_touch.get(task.id) or aware(task.updated_at))).days
            if days >= BLOCKED_DAYS:
                risks.append(Risk(f"blocked:{task.id}", "blocked", f"“{task.title}” has been in Doing for {days} days."))
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).all():
        days = (at - (last_active.get(member.user_id) or aware(member.joined_at))).days
        if days >= QUIET_DAYS:
            risks.append(Risk(f"quiet:{member.user_id}", "quiet", f"You haven't been active in the team for {days} days. A quick update helps everyone plan.", member.user_id))
    return risks


def post_notices(db: Session, team: Team, at: datetime | None = None) -> list[TeamMessage]:
    """Post today's new risks as notices. The caller commits."""
    at = at or now()
    day_start = at.replace(hour=0, minute=0, second=0, microsecond=0)
    today = db.scalars(select(TeamMessage).where(
        TeamMessage.team_id == team.id, TeamMessage.kind == "notice", TeamMessage.created_at >= day_start,
    )).all()
    posted = {loads(message.metadata_json, {}).get("risk_key") for message in today}
    team_count = sum(1 for message in today if message.visible_to_user_id is None)
    created: list[TeamMessage] = []
    for risk in assess(db, team, at):
        if risk.key in posted:
            continue
        if risk.user_id is None:
            if team_count >= DAILY_TEAM_NOTICES:
                continue
            team_count += 1
        created.append(post_message(db, team.id, None, risk.text, kind="notice",
                                    metadata={"risk_key": risk.key, "risk_kind": risk.kind}, visible_to_user_id=risk.user_id))
    return created


def team_risk_line(db: Session, team: Team) -> str | None:
    return next((risk.text for risk in assess(db, team) if risk.user_id is None), None)


@router.get("/v1/teams/{team_id}/risks")
def team_risks(team_id: str, db: Db, user: CurrentUser) -> list[dict]:
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    return [
        {"key": risk.key, "kind": risk.kind, "text": risk.text, "private": risk.user_id is not None}
        for risk in assess(db, team)
        if risk.user_id is None or (is_member(role) and risk.user_id == user.id)
    ]
