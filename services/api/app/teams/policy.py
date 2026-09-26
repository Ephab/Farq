from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import User
from .models import Assignment, CourseEnrollment, Team, TeamMember

# Who may do what inside a team. Chat ("view_chat") is members only: course
# instructors see everything else (docs/superpowers/specs/2026-09-25-group-projects-design.md §5).
ACTIONS: dict[str, set[str]] = {
    "view": {"member", "instructor"},
    "view_chat": {"member"},
    "write": {"member"},
    "lead": {"lead"},
}


def team_role(db: Session, user: User, team: Team) -> str | None:
    if db.scalar(select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id)):
        return "lead" if team.lead_user_id == user.id else "member"
    assignment = db.get(Assignment, team.assignment_id)
    if assignment is not None and db.scalar(
        select(CourseEnrollment.id).where(
            CourseEnrollment.course_id == assignment.course_id,
            CourseEnrollment.user_id == user.id,
            CourseEnrollment.role == "instructor",
        )
    ):
        return "instructor"
    return None


def is_member(role: str | None) -> bool:
    return role in {"member", "lead"}


def authorize(db: Session, user: User, team: Team, action: str) -> str:
    """Return the viewer's role in the team, or raise 403."""
    role = team_role(db, user, team)
    held = {role, "member"} if role == "lead" else {role}
    if role is None or not held & ACTIONS[action]:
        raise HTTPException(403, "You don't have access to this part of the team")
    return role
