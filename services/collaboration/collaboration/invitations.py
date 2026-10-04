"""Peer classes and expiring, revocable code invitations. No personal records."""
from datetime import datetime, timedelta
import hashlib
import secrets
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, select, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .identity import CurrentUser, User
from .models import now, uid
from .teams.common import Db, aware, iso, require_team
from .teams.events import emit
from .teams.models import Course, CourseEnrollment, Assignment, Team, TeamMember, TeamInvite
from .teams.policy import authorize
from .teams.teams import _join, _members, team_capacity, team_for_assignment, assignment_dict


class CodeInvite(Base):
    __tablename__ = "code_invites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    course_id: Mapped[str | None] = mapped_column(ForeignKey("courses.id"), nullable=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int] = mapped_column(Integer)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    revoked: Mapped[int] = mapped_column(Integer, default=0)


class InviteRedemption(Base):
    __tablename__ = "invite_redemptions"
    invite_id: Mapped[str] = mapped_column(ForeignKey("code_invites.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)


class InviteRate(Base):
    __tablename__ = "invite_rates"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer)


class ClassRemoval(Base):
    __tablename__ = "class_removals"
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)


router = APIRouter()


class ClassCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    code: str = Field(default="", max_length=32)


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=2, max_length=240)
    team_size_max: int = Field(default=6, ge=2, le=50)


class CodeCreate(BaseModel):
    hours: int = Field(default=24, ge=1, le=168)
    max_uses: int = Field(default=30, ge=1, le=200)


class CodeRedeem(BaseModel):
    code: str = Field(min_length=1, max_length=32)


def enrolled(db, course_id, user_id):
    return db.scalar(select(CourseEnrollment).where(CourseEnrollment.course_id == course_id, CourseEnrollment.user_id == user_id))


def classroom(db, class_id, user_id, *, organizer=False, allow_archived=False):
    course = db.get(Course, class_id)
    if course is None or course.source != "peer" or not enrolled(db, class_id, user_id):
        raise HTTPException(404, "Class not found")
    if organizer and course.organizer_id != user_id:
        raise HTTPException(403, "Only the class organizer can do this")
    if course.archived_at and not allow_archived:
        raise HTTPException(404, "Class is archived")
    return course


def class_dict(course, user_id):
    return {"id": course.id, "title": course.title, "code": course.code, "organizer": course.organizer_id == user_id, "archived": bool(course.archived_at)}


@router.get("/v1/classes")
def classes(db: Db, user: CurrentUser):
    rows = db.scalars(select(Course).join(CourseEnrollment).where(CourseEnrollment.user_id == user.id, Course.source == "peer").order_by(Course.created_at.desc()).limit(200))
    return [class_dict(row, user.id) for row in rows]


@router.post("/v1/classes", status_code=201)
def create_class(body: ClassCreate, db: Db, user: CurrentUser):
    if len(body.title.strip()) < 2:
        raise HTTPException(422, "Give your class a name")
    count = db.scalar(select(func.count()).select_from(Course).where(Course.creator_id == user.id, Course.created_at > now() - timedelta(days=1)))
    if count >= 3:
        raise HTTPException(429, "Class creation limit reached; try tomorrow")
    course = Course(title=body.title.strip(), code=body.code.strip(), source="peer", organizer_id=user.id, creator_id=user.id)
    db.add(course)
    db.flush()
    # An organizer is a student, never an instructor.
    db.add(CourseEnrollment(course_id=course.id, user_id=user.id, role="student"))
    db.commit()
    return class_dict(course, user.id)


@router.get("/v1/classes/{class_id}")
def class_detail(class_id: str, db: Db, user: CurrentUser):
    course = classroom(db, class_id, user.id, allow_archived=True)
    members = db.execute(select(User.id, User.display_name).join(CourseEnrollment, CourseEnrollment.user_id == User.id).where(CourseEnrollment.course_id == class_id).limit(200)).all()
    assignments = db.scalars(select(Assignment).where(Assignment.course_id == class_id)).all()
    return class_dict(course, user.id) | {"members": [{"id": row.id, "display_name": row.display_name} for row in members], "assignments": [assignment_dict(row) for row in assignments]}


@router.post("/v1/classes/{class_id}/assignments", status_code=201)
def add_assignment(class_id: str, body: AssignmentCreate, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id, organizer=True)
    if len(body.title.strip()) < 2:
        raise HTTPException(422, "Give the assignment a name")
    if db.scalar(select(func.count()).select_from(Assignment).where(Assignment.course_id == class_id)) >= 30:
        raise HTTPException(409, "This class has reached its assignment limit")
    assignment = Assignment(course_id=class_id, title=body.title.strip(), team_size_max=body.team_size_max)
    db.add(assignment)
    db.commit()
    return assignment_dict(assignment)


def issue(db, body, user_id, *, course_id=None, team_id=None):
    rows = db.scalars(select(CodeInvite).where(CodeInvite.created_by == user_id, CodeInvite.revoked == 0, CodeInvite.expires_at > now())).all()
    if len(rows) >= 20:
        raise HTTPException(429, "Revoke an unused invitation before creating more")
    # 80 random bits, case-insensitive grouped code. Only the digest is retained.
    import base64
    raw = base64.b32encode(secrets.token_bytes(10)).decode()
    invite = CodeInvite(code_hash=hashlib.sha256(raw.encode()).hexdigest(), course_id=course_id, team_id=team_id,
                        created_by=user_id, expires_at=now() + timedelta(hours=body.hours), max_uses=body.max_uses)
    db.add(invite)
    db.flush()
    if team_id:
        emit(db, team_id, "invite.code_created", user_id, {"invite_id": invite.id, "expires_at": iso(invite.expires_at)})
    db.commit()
    return {"id": invite.id, "code": "-".join(raw[index:index+4] for index in range(0, 16, 4)), "expires_at": iso(invite.expires_at), "max_uses": invite.max_uses}


@router.post("/v1/classes/{class_id}/codes", status_code=201)
def class_code(class_id: str, body: CodeCreate, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id, organizer=True)
    return issue(db, body, user.id, course_id=class_id)


@router.post("/v1/teams/{team_id}/codes", status_code=201)
def team_code(team_id: str, body: CodeCreate, db: Db, user: CurrentUser):
    authorize(db, user, require_team(db, team_id), "lead")
    return issue(db, body, user.id, team_id=team_id)


@router.delete("/v1/codes/{invite_id}")
def revoke(invite_id: str, db: Db, user: CurrentUser):
    invite = db.get(CodeInvite, invite_id)
    if invite is None:
        raise HTTPException(404, "Invitation not found")
    if invite.team_id:
        authorize(db, user, require_team(db, invite.team_id), "lead")
    else:
        classroom(db, invite.course_id, user.id, organizer=True)
    invite.revoked = 1
    if invite.team_id:
        emit(db, invite.team_id, "invite.code_revoked", user.id, {"invite_id": invite.id})
    db.commit()
    return {"revoked": True}


def throttle(db, user_id, address, namespace="code"):
    window = int(time.time()) // 60
    blocked = False
    for scope in ("account:" + user_id, "ip:" + address):
        key = hashlib.sha256((namespace + ":" + scope).encode()).hexdigest()
        rate = db.get(InviteRate, key)
        if rate is None:
            rate = InviteRate(key=key, window=window, count=0)
            db.add(rate)
        if rate.window != window:
            rate.window, rate.count = window, 0
        rate.count += 1
        blocked |= rate.count > 10
    # Invalid attempts and rejected joins must still consume the persistent quota.
    db.commit()
    if blocked:
        raise HTTPException(429, "Too many attempts; try in a minute")


@router.post("/v1/codes/redeem")
def redeem(body: CodeRedeem, request: Request, db: Db, user: CurrentUser):
    throttle(db, user.id, request.client.host if request.client else "unknown")
    raw = body.code.upper().replace("-", "").replace(" ", "")
    invite = db.scalar(select(CodeInvite).where(CodeInvite.code_hash == hashlib.sha256(raw.encode()).hexdigest()))
    if invite is None or invite.revoked or aware(invite.expires_at) <= now():
        raise HTTPException(404, "Invitation is invalid or expired")
    previous = db.get(InviteRedemption, (invite.id, user.id))
    if invite.team_id:
        team = require_team(db, invite.team_id)
        member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
        if previous and member:
            return {"team_id": team.id}
        if previous:
            raise HTTPException(404, "Invitation is invalid or expired")
        assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
        if assignment and not enrolled(db, assignment.course_id, user.id):
            raise HTTPException(403, "Join the class before joining this project")
        if assignment and team_for_assignment(db, assignment.id, user.id) and not member:
            raise HTTPException(409, "You already have a team for this assignment")
        if not member and len(_members(db, team.id)) >= team_capacity(team, assignment):
            raise HTTPException(409, "This project is full")
        result = {"team_id": team.id}
    else:
        course = db.get(Course, invite.course_id)
        if course.archived_at:
            raise HTTPException(404, "Invitation is invalid or expired")
        if db.get(ClassRemoval, (course.id, user.id)):
            raise HTTPException(404, "Invitation is invalid or expired")
        member = enrolled(db, course.id, user.id)
        if previous and member:
            return {"class_id": course.id}
        if previous:
            raise HTTPException(404, "Invitation is invalid or expired")
        if not member and db.scalar(select(func.count()).select_from(CourseEnrollment).where(CourseEnrollment.course_id == course.id)) >= 200:
            raise HTTPException(409, "This class is full")
        result = {"class_id": course.id}
    if invite.uses >= invite.max_uses:
        raise HTTPException(404, "Invitation is invalid or expired")
    if not member:
        if invite.team_id:
            _join(db, team, user)
        else:
            db.add(CourseEnrollment(course_id=course.id, user_id=user.id, role="student"))
    invite.uses += 1
    db.add(InviteRedemption(invite_id=invite.id, account_id=user.id))
    if invite.team_id:
        emit(db, team.id, "invite.code_redeemed", user.id, {"invite_id": invite.id})
    db.commit()
    return result


@router.delete("/v1/classes/{class_id}/members/{account_id}")
def remove_class_member(class_id: str, account_id: str, db: Db, user: CurrentUser):
    course = classroom(db, class_id, user.id, organizer=account_id != user.id)
    if account_id == course.organizer_id:
        raise HTTPException(409, "The organizer cannot leave the class yet")
    enrollment = enrolled(db, class_id, account_id)
    if enrollment is None:
        raise HTTPException(404, "Member not found")
    teams = db.scalars(select(Team).join(Assignment).join(TeamMember).where(Assignment.course_id == class_id, TeamMember.user_id == account_id)).all()
    if any(team.lead_user_id == account_id for team in teams):
        raise HTTPException(409, "Transfer project leadership before removing this member")
    for team in teams:
        member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == account_id))
        from .team_profiles import withdraw_member
        withdraw_member(db, team.id, account_id, user.id)
        db.delete(member)
        emit(db, team.id, "member.removed", user.id, {"user_id": account_id})
    assignment_ids = select(Assignment.id).where(Assignment.course_id == class_id)
    team_ids = select(Team.id).where(Team.assignment_id.in_(assignment_ids))
    for invite in db.scalars(select(TeamInvite).where(TeamInvite.team_id.in_(team_ids), TeamInvite.invited_user_id == account_id, TeamInvite.status == "pending")):
        invite.status = "declined"
        emit(db, invite.team_id, "invite.declined", user.id, {"invite_id": invite.id})
    db.delete(enrollment)
    from .profiles import SharedProfile, DiscoveryPreference, withdraw
    shared = db.get(SharedProfile, (class_id, account_id))
    if shared:
        withdraw(db, shared, "membership_end")
    else:
        preferences = db.get(DiscoveryPreference, (class_id, account_id))
        if preferences:
            db.delete(preferences)
    if account_id != user.id:
        db.merge(ClassRemoval(course_id=class_id, account_id=account_id))
    db.commit()
    return {"removed": True}


@router.post("/v1/classes/{class_id}/members/{account_id}/restore")
def restore_class_member(class_id: str, account_id: str, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id, organizer=True)
    removal = db.get(ClassRemoval, (class_id, account_id))
    if removal:
        db.delete(removal)
    # Restoring eligibility does not enroll the student; they must join explicitly.
    db.commit()
    return {"eligible": True}
