from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..identity import CurrentUser, User, user_dict
from ..models import uid
from .common import Db, iso, loads, project_dict, require, require_team
from .events import emit
from .models import Assignment, Course, CourseEnrollment, Task, Team, TeamCutover, TeamEvent, TeamInvite, TeamMember
from .notices import team_risk_line
from .policy import authorize, is_member

from .proposals import BriefPayload, Deliverable

router = APIRouter()
STATUS_RANK = {"doing": 0, "review": 1, "todo": 2}


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    size_limit: int | None = Field(default=None, ge=1, le=50)


def team_capacity(team: Team, assignment: Assignment) -> int:
    return team.size_limit or assignment.team_size_max


class InviteCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=36)


def course_dict(course: Course) -> dict:
    return {"id": course.id, "code": course.code, "title": course.title, "term": course.term}


def assignment_dict(assignment: Assignment) -> dict:
    return {
        "id": assignment.id, "course_id": assignment.course_id, "title": assignment.title,
        "brief": loads(assignment.brief_json, {}), "deadline": iso(assignment.deadline),
        "deliverables": loads(assignment.deliverables_json, []), "rubric": loads(assignment.rubric_json, []),
        "team_size_min": assignment.team_size_min, "team_size_max": assignment.team_size_max,
    }


def _members(db: Session, team_id: str) -> list[TeamMember]:
    return db.scalars(select(TeamMember).where(TeamMember.team_id == team_id).order_by(TeamMember.joined_at)).all()


def member_dicts(db: Session, team: Team) -> list[dict]:
    result = []
    for member in _members(db, team.id):
        user = db.get(User, member.user_id)
        result.append({
            "user_id": member.user_id, "display_name": user.display_name if user else member.user_id,
            "role_label": member.role_label, "is_lead": member.user_id == team.lead_user_id,
        })
    return result


def team_dict(db: Session, team: Team, viewer_role: str) -> dict:
    assignment = db.get(Assignment, team.assignment_id)
    return {
        "id": team.id, "name": team.name, "cover_seed": team.cover_seed, "lead_user_id": team.lead_user_id,
        "charter": loads(team.charter_json, {}), "created_at": iso(team.created_at), "viewer_role": viewer_role,
        "assignment": assignment_dict(assignment) | loads(team.assignment_override_json, {}), "project": project_dict(team), "course": course_dict(db.get(Course, assignment.course_id)),
        "members": member_dicts(db, team), "size_limit": team_capacity(team, assignment),
    }


def team_for_assignment(db: Session, assignment_id: str, user_id: str) -> Team | None:
    return db.scalar(
        select(Team).join(TeamMember, TeamMember.team_id == Team.id)
        .where(Team.assignment_id == assignment_id, TeamMember.user_id == user_id)
    )


def _enrollment(db: Session, course_id: str, user_id: str) -> CourseEnrollment | None:
    return db.scalar(select(CourseEnrollment).where(CourseEnrollment.course_id == course_id, CourseEnrollment.user_id == user_id))


def team_card(db: Session, team: Team, user: User, role: str) -> dict:
    assignment = db.get(Assignment, team.assignment_id)
    tasks = db.scalars(select(Task).where(Task.team_id == team.id)).all()
    total = sum(task.estimate_points for task in tasks)
    done = sum(task.estimate_points for task in tasks if task.status == "done")
    next_task, unread = None, None
    if is_member(role):
        mine = [task for task in tasks if task.assignee_id == user.id and task.status != "done"]
        mine.sort(key=lambda task: (STATUS_RANK.get(task.status, 3), iso(task.due) or "9999", task.position))
        if mine:
            next_task = {"id": mine[0].id, "title": mine[0].title, "estimate_points": mine[0].estimate_points, "status": mine[0].status}
        member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
        unread = db.scalar(
            select(func.count()).select_from(TeamEvent).where(
                TeamEvent.team_id == team.id, TeamEvent.seq > member.last_seen_seq, TeamEvent.type == "message.created",
                (TeamEvent.actor_user_id.is_(None)) | (TeamEvent.actor_user_id != user.id),
                (TeamEvent.visible_to_user_id.is_(None)) | (TeamEvent.visible_to_user_id == user.id),
            )
        )
    return {
        "id": team.id, "name": team.name, "cover_seed": team.cover_seed,
        "course": course_dict(db.get(Course, assignment.course_id)),
        "assignment": {"id": assignment.id, "title": assignment.title, "deadline": iso(assignment.deadline)},
        "progress": round(100 * done / total) if total else 0, "next_task": next_task,
        "members": [member.user_id for member in _members(db, team.id)], "unread": unread, "viewer_role": role, "moved": db.get(TeamCutover, team.id) is not None,
        "risk": team_risk_line(db, team),
    }


def invite_dict(db: Session, invite: TeamInvite) -> dict:
    team = db.get(Team, invite.team_id)
    assignment = db.get(Assignment, team.assignment_id)
    inviter = db.get(User, invite.invited_by)
    return {
        "id": invite.id, "team_id": team.id, "team_name": team.name, "assignment_title": assignment.title,
        "invited_user_id": invite.invited_user_id, "invited_by_name": inviter.display_name if inviter else "",
        "status": invite.status, "created_at": iso(invite.created_at),
    }


@router.get("/api/me/teams-home")
def teams_home(db: Db, user: CurrentUser) -> dict:
    cards, needs = [], []
    for enrollment in db.scalars(select(CourseEnrollment).where(CourseEnrollment.user_id == user.id)).all():
        course = db.get(Course, enrollment.course_id)
        for assignment in db.scalars(select(Assignment).where(Assignment.course_id == course.id).order_by(Assignment.deadline)).all():
            if enrollment.role == "instructor":
                for team in db.scalars(select(Team).where(Team.assignment_id == assignment.id).order_by(Team.name)).all():
                    cards.append(team_card(db, team, user, "instructor"))
                continue
            team = team_for_assignment(db, assignment.id, user.id)
            if team is not None:
                cards.append(team_card(db, team, user, "lead" if team.lead_user_id == user.id else "member"))
                continue
            classmates = db.scalars(select(CourseEnrollment.user_id).where(
                CourseEnrollment.course_id == course.id, CourseEnrollment.role == "student", CourseEnrollment.user_id != user.id,
            )).all()
            open_count = sum(1 for classmate in classmates if team_for_assignment(db, assignment.id, classmate) is None)
            needs.append({
                "assignment_id": assignment.id, "title": assignment.title, "deadline": iso(assignment.deadline),
                "course": course_dict(course), "team_size_min": assignment.team_size_min,
                "team_size_max": assignment.team_size_max, "open_classmates": open_count,
            })
    invites = db.scalars(select(TeamInvite).where(TeamInvite.invited_user_id == user.id, TeamInvite.status == "pending")).all()
    return {"user": user_dict(user), "teams": cards, "needs_team": needs, "invites": [invite_dict(db, item) for item in invites]}


def _join(db: Session, team: Team, user: User, role_label: str = "") -> None:
    """Add a membership and cancel the user's other pending invites for this
    assignment. The unique (assignment_id, user_id) constraint makes a racing
    second join fail here instead of leaving the student on two teams."""
    db.add(TeamMember(team_id=team.id, assignment_id=team.assignment_id, user_id=user.id, role_label=role_label))
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(409, "You already have a team for this assignment") from error
    stale = db.scalars(
        select(TeamInvite).join(Team, Team.id == TeamInvite.team_id).where(
            Team.assignment_id == team.assignment_id, TeamInvite.invited_user_id == user.id,
            TeamInvite.status == "pending", TeamInvite.team_id != team.id,
        )
    ).all()
    for invite in stale:
        invite.status = "cancelled"
        emit(db, invite.team_id, "invite.cancelled", user.id, {"id": invite.id, "user_id": user.id})
    emit(db, team.id, "member.joined", user.id, {"user_id": user.id, "display_name": user.display_name})


@router.post("/api/assignments/{assignment_id}/teams", status_code=201)
def create_team(assignment_id: str, body: TeamCreate, db: Db, user: CurrentUser) -> dict:
    assignment = require(db, Assignment, assignment_id, "Assignment")
    enrollment = _enrollment(db, assignment.course_id, user.id)
    if enrollment is None or enrollment.role != "student":
        raise HTTPException(403, "Only students enrolled in this course can form a team")
    if team_for_assignment(db, assignment.id, user.id) is not None:
        raise HTTPException(409, "You already have a team for this assignment")
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(422, "Give your team a name")
    seed = hashlib.sha256(f"{name}:{uid()}".encode()).hexdigest()[:12]
    team = Team(assignment_id=assignment.id, name=name, cover_seed=seed, lead_user_id=user.id)
    db.add(team)
    db.flush()
    _join(db, team, user, "Lead")
    db.commit()
    return team_dict(db, team, "lead")


@router.get("/api/assignments/{assignment_id}/classmates")
def list_classmates(assignment_id: str, db: Db, user: CurrentUser) -> list[dict]:
    assignment = require(db, Assignment, assignment_id, "Assignment")
    if _enrollment(db, assignment.course_id, user.id) is None:
        raise HTTPException(403, "You are not enrolled in this course")
    rows = []
    for enrollment in db.scalars(select(CourseEnrollment).where(
        CourseEnrollment.course_id == assignment.course_id, CourseEnrollment.role == "student", CourseEnrollment.user_id != user.id,
    )).all():
        person = db.get(User, enrollment.user_id)
        rows.append({
            "user_id": enrollment.user_id, "display_name": person.display_name if person else enrollment.user_id,
            "has_team": team_for_assignment(db, assignment.id, enrollment.user_id) is not None,
        })
    return sorted(rows, key=lambda row: row["display_name"].lower())


@router.post("/api/teams/{team_id}/invites", status_code=201)
def invite_member(team_id: str, body: InviteCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    assignment = db.get(Assignment, team.assignment_id)
    enrollment = _enrollment(db, assignment.course_id, body.user_id)
    if db.get(User, body.user_id) is None or enrollment is None or enrollment.role != "student":
        raise HTTPException(422, "Only classmates in this course can be invited")
    if team_for_assignment(db, assignment.id, body.user_id) is not None:
        raise HTTPException(409, "They already have a team for this assignment")
    pending = db.scalars(select(TeamInvite).where(TeamInvite.team_id == team.id, TeamInvite.status == "pending")).all()
    if any(item.invited_user_id == body.user_id for item in pending):
        raise HTTPException(409, "They already have a pending invite")
    if len(_members(db, team.id)) + len(pending) >= team_capacity(team, assignment):
        raise HTTPException(409, "This team is full")
    invite = TeamInvite(team_id=team.id, invited_user_id=body.user_id, invited_by=user.id)
    db.add(invite)
    db.flush()
    emit(db, team.id, "invite.created", user.id, invite_dict(db, invite))
    db.commit()
    return invite_dict(db, invite)


def _pending_invite_for(db: Session, invite_id: str, user: User) -> TeamInvite:
    invite = require(db, TeamInvite, invite_id, "Invite")
    if invite.invited_user_id != user.id:
        raise HTTPException(403, "This invite is for someone else")
    if invite.status != "pending":
        raise HTTPException(409, "This invite was already answered")
    return invite


@router.post("/api/invites/{invite_id}/accept")
def accept_invite(invite_id: str, db: Db, user: CurrentUser) -> dict:
    invite = _pending_invite_for(db, invite_id, user)
    team = db.get(Team, invite.team_id)
    assignment = db.get(Assignment, team.assignment_id)
    if team_for_assignment(db, assignment.id, user.id) is not None:
        raise HTTPException(409, "You already joined a team for this assignment")
    if len(_members(db, team.id)) >= team_capacity(team, assignment):
        raise HTTPException(409, "This team filled up")
    invite.status = "accepted"
    _join(db, team, user)
    db.commit()
    return team_dict(db, team, "member")


@router.post("/api/invites/{invite_id}/decline")
def decline_invite(invite_id: str, db: Db, user: CurrentUser) -> dict:
    invite = _pending_invite_for(db, invite_id, user)
    invite.status = "declined"
    emit(db, invite.team_id, "invite.declined", user.id, {"id": invite.id, "user_id": user.id})
    db.commit()
    return invite_dict(db, invite)


@router.patch("/api/teams/{team_id}")
def update_team(team_id: str, body: TeamUpdate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "lead")
    assignment = db.get(Assignment, team.assignment_id)
    if not body.model_fields_set:
        raise HTTPException(422, "Nothing to update")
    if body.name is not None:
        name = body.name.strip()
        if len(name) < 2:
            raise HTTPException(422, "Give your team a name")
        team.name = name
    if body.size_limit is not None:
        members = len(_members(db, team.id))
        low, high = max(members, assignment.team_size_min), assignment.team_size_max
        if not low <= body.size_limit <= high:
            raise HTTPException(422, f"Team size must be between {low} and {high}")
        team.size_limit = body.size_limit
    emit(db, team.id, "team.updated", user.id, {"name": team.name, "size_limit": team_capacity(team, assignment)})
    db.commit()
    return team_dict(db, team, "lead")


@router.get("/api/teams/{team_id}")
def get_team(team_id: str, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    return team_dict(db, team, authorize(db, user, team, "view"))


@router.post("/api/teams/{team_id}/leave")
def leave_team(team_id: str, db: Db, user: CurrentUser):
    from .common import lock_for_write
    lock_for_write(db)
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    member = db.scalar(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id))
    remaining = db.scalars(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id != user.id)
                          .order_by(TeamMember.joined_at, TeamMember.id)).all()
    if team.lead_user_id == user.id and remaining:
        team.lead_user_id = remaining[0].user_id
        emit(db, team_id, "team.updated", user.id, {"lead_user_id": team.lead_user_id})

    db.delete(member)
    emit(db, team_id, "member.removed", user.id, {"user_id": user.id})
    db.commit()
    return {"left": True}


class ProjectDetails(BaseModel):
    brief: BriefPayload
    deliverables: list[Deliverable] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique_keys(self):
        if len({item.key for item in self.deliverables}) != len(self.deliverables):
            raise ValueError("Deliverable keys must be unique")
        return self


class AssignmentDetails(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    problem: str = Field(default="", max_length=3000)
    objective: str = Field(default="", max_length=3000)
    deliverables: list[str] = Field(default_factory=list, max_length=20)
    constraints: list[str] = Field(default_factory=list, max_length=20)


class ProjectDetailsUpdate(BaseModel):
    project: ProjectDetails | None = None
    assignment: AssignmentDetails | None = None


@router.patch("/api/teams/{team_id}/project-details")
def edit_project_details(team_id: str, body: ProjectDetailsUpdate, db: Db, user: CurrentUser):
    from .common import lock_for_write
    lock_for_write(db)
    team = require_team(db, team_id)
    authorize(db, user, team, "lead")
    if body.project is None and body.assignment is None:
        raise HTTPException(422, "Nothing to update")
    if body.assignment is not None and not body.assignment.title.strip():
        raise HTTPException(422, "Give the assignment a title")
    changed = {}
    if body.project is not None:
        team.brief_json = body.project.brief.model_dump_json()
        team.deliverables_json = json.dumps([item.model_dump(mode="json") for item in body.project.deliverables])
        changed["project"] = project_dict(team)
    if body.assignment is not None:
        assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
        existing = loads(team.assignment_override_json, {}).get("brief", loads(assignment.brief_json, {}) if assignment else {})
        brief = existing | body.assignment.model_dump(exclude={"title"})
        team.assignment_override_json = json.dumps({"title": body.assignment.title.strip(), "brief": brief, "deliverables": body.assignment.deliverables})
        changed["assignment"] = assignment_dict(assignment) | loads(team.assignment_override_json, {})
    emit(db, team_id, "team.updated", user.id, changed)
    db.commit()
    return team_dict(db, team, "lead")
