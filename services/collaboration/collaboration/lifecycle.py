"""Reversible archival and explicit ownership transfer; no history deletion."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from .identity import CurrentUser, User
from .invitations import classroom, enrolled, CodeInvite
from .models import now
from .openings import TeamOpening, JoinRequest
from .teams.common import Db, require
from .teams.models import Assignment, Course, Team, TeamMember, TeamInvite
from .teams.events import emit

router = APIRouter()


class TransferInput(BaseModel):
    account_id: str = Field(min_length=1, max_length=36)


@router.post("/v1/classes/{class_id}/organizer")
def transfer_class(class_id: str, body: TransferInput, db: Db, user: CurrentUser):
    course = classroom(db, class_id, user.id, organizer=True, allow_archived=True)
    membership, account = enrolled(db, class_id, body.account_id), db.get(User, body.account_id)
    if membership is None or membership.role != "student" or account is None or account.disabled:
        raise HTTPException(409, "The new organizer must be an active student in this class")
    course.organizer_id = account.id
    db.commit()
    return {"organizer_id": account.id}


def close_team_access(db, team, actor_id):
    from .team_profiles import TeamProfile, withdraw_member
    for profile in db.scalars(select(TeamProfile).where(TeamProfile.team_id == team.id)):
        withdraw_member(db, team.id, profile.account_id, actor_id, "archive")
    for invitation in db.scalars(select(CodeInvite).where(CodeInvite.team_id == team.id, CodeInvite.revoked == 0)):
        invitation.revoked = 1
        emit(db, team.id, "invite.code_revoked", actor_id, {"invite_id": invitation.id})
    for invitation in db.scalars(select(TeamInvite).where(TeamInvite.team_id == team.id, TeamInvite.status == "pending")):
        invitation.status = "cancelled"
        emit(db, team.id, "invite.cancelled", actor_id, {"id": invitation.id, "user_id": invitation.invited_user_id})
    opening = db.get(TeamOpening, team.id)
    if opening:
        opening.closed = "yes"
        emit(db, team.id, "opening.updated", actor_id, {"open": False})
    for row in db.scalars(select(JoinRequest).where(JoinRequest.team_id == team.id, JoinRequest.status == "pending")):
        row.status = "cancelled"
        emit(db, team.id, "join_request.updated", actor_id, {"request_id": row.id, "status": row.status}, visible_to_user_id=team.lead_user_id)


@router.post("/v1/classes/{class_id}/{action}")
def class_archive(class_id: str, action: str, db: Db, user: CurrentUser):
    if action not in {"archive", "restore"}:
        raise HTTPException(404, "Action not found")
    course = classroom(db, class_id, user.id, organizer=True, allow_archived=True)
    archived = action == "archive"
    if bool(course.archived_at) == archived:
        return {"archived": archived}
    course.archived_at = now() if archived else None
    if archived:
        from .profiles import SharedProfile, DiscoveryPreference, withdraw
        from sqlalchemy import delete
        for profile in db.scalars(select(SharedProfile).where(SharedProfile.class_id == class_id)):
            withdraw(db, profile, "class_archive")
        db.execute(delete(DiscoveryPreference).where(DiscoveryPreference.class_id == class_id))
        for invitation in db.scalars(select(CodeInvite).where(CodeInvite.course_id == course.id)):
            invitation.revoked = 1
    for team in db.scalars(select(Team).join(Assignment).where(Assignment.course_id == course.id)):
        if archived:
            close_team_access(db, team, user.id)
        emit(db, team.id, "class.archived" if archived else "class.restored", user.id, {"class_id": class_id})
    db.commit()
    return {"archived": archived}


@router.post("/v1/teams/{team_id}/{action}")
def project_archive(team_id: str, action: str, db: Db, user: CurrentUser):
    if action not in {"archive", "restore"}:
        raise HTTPException(404, "Action not found")
    team = require(db, Team, team_id, "Project")
    if team.lead_user_id != user.id or not db.scalar(select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id)):
        raise HTTPException(403, "Only the project lead can do this")
    assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
    if assignment and db.get(Course, assignment.course_id).archived_at:
        raise HTTPException(409, "Restore the class before changing its projects")
    archived = action == "archive"
    if bool(team.archived_at) == archived:
        return {"archived": archived}
    team.archived_at = now() if archived else None
    if archived:
        close_team_access(db, team, user.id)
    emit(db, team.id, "team.archived" if archived else "team.restored", user.id, {})
    db.commit()
    return {"archived": archived}


@router.get("/v1/me/archived-teams")
def archived_projects(db: Db, user: CurrentUser):
    teams = db.scalars(select(Team).join(TeamMember).where(TeamMember.user_id == user.id, Team.archived_at.is_not(None)).limit(200))
    return [{"id": team.id, "name": team.name, "can_restore": team.lead_user_id == user.id,
             "class_archived": bool(db.get(Course, db.get(Assignment, team.assignment_id).course_id).archived_at) if team.assignment_id else False}
            for team in teams]
