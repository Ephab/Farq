"""Class-scoped openings and explicit, lead-approved membership requests."""
from datetime import datetime, timedelta
import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, select, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .identity import CurrentUser, User
from .models import now, uid
from .invitations import classroom, enrolled, throttle
from .teams.common import Db, aware, iso, require_team, team_archived
from .teams.events import emit
from .teams.models import Assignment, Team, TeamMember
from .teams.policy import authorize
from .teams.teams import _join, _members, team_capacity, team_for_assignment


class TeamOpening(Base):
    __tablename__ = "team_openings"
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), primary_key=True)
    summary: Mapped[str] = mapped_column(String(500))
    roles_json: Mapped[str] = mapped_column(Text, default="[]")
    commitment: Mapped[str] = mapped_column(String(160), default="")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed: Mapped[str] = mapped_column(String(8), default="no")


class JoinRequest(Base):
    __tablename__ = "team_join_requests"
    __table_args__ = (UniqueConstraint("team_id", "account_id", name="uq_join_request_team_account"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    note: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


router = APIRouter()


class OpeningInput(BaseModel):
    summary: str = Field(default="", max_length=500)
    roles: list[str] = Field(default_factory=list, max_length=8)
    commitment: str = Field(default="", max_length=160)
    days: int = Field(default=7, ge=1, le=30)


class JoinInput(BaseModel):
    note: str = Field(default="", max_length=500)
    match_snapshot: str | None = Field(default=None, min_length=64, max_length=64)


def live(opening):
    return opening is not None and opening.closed == "no" and aware(opening.expires_at) > now()


def scope(db, team, account_id):
    assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
    if assignment is None:
        raise HTTPException(404, "Opening not found")
    classroom(db, assignment.course_id, account_id)
    enrollment = enrolled(db, assignment.course_id, account_id)
    if enrollment.role != "student":
        raise HTTPException(403, "Only students can request a place")
    return assignment


def request_dict(db, row):
    account = db.get(User, row.account_id)
    team = db.get(Team, row.team_id)
    status = "expired" if row.status == "pending" and aware(row.expires_at) <= now() else row.status
    return {"id": row.id, "team_id": row.team_id, "team_name": team.name, "account_id": row.account_id,
            "display_name": account.display_name if account else "", "note": row.note,
            "status": status, "expires_at": iso(row.expires_at)}


@router.put("/v1/teams/{team_id}/opening")
def publish(team_id: str, body: OpeningInput, db: Db, user: CurrentUser):
    team = require_team(db, team_id)
    authorize(db, user, team, "lead")
    assignment = scope(db, team, user.id)
    roles = list(dict.fromkeys(role.strip() for role in body.roles if role.strip()))
    if len(body.summary.strip()) < 2 or any(len(role) > 80 for role in roles):
        raise HTTPException(422, "Use a summary and role names of at most 80 characters")
    if len(_members(db, team.id)) >= team_capacity(team, assignment):
        raise HTTPException(409, "This project is full")
    opening = db.get(TeamOpening, team.id)
    if opening is None:
        opening = TeamOpening(team_id=team.id)
        db.add(opening)
    opening.summary, opening.roles_json, opening.commitment = body.summary.strip(), json.dumps(roles), body.commitment.strip()
    opening.expires_at, opening.closed = now() + timedelta(days=body.days), "no"
    emit(db, team.id, "opening.updated", user.id, {"open": True})
    db.commit()
    return {"open": True, "expires_at": iso(opening.expires_at)}


@router.delete("/v1/teams/{team_id}/opening")
def close(team_id: str, db: Db, user: CurrentUser):
    team = require_team(db, team_id)
    authorize(db, user, team, "lead")
    opening = db.get(TeamOpening, team_id)
    if opening:
        opening.closed = "yes"
    for row in db.scalars(select(JoinRequest).where(JoinRequest.team_id == team_id, JoinRequest.status == "pending")):
        row.status = "cancelled"
        emit(db, team.id, "join_request.updated", user.id, {"request_id": row.id, "status": row.status}, visible_to_user_id=user.id)
    emit(db, team.id, "opening.updated", user.id, {"open": False})
    db.commit()
    return {"open": False}


@router.get("/v1/teams/{team_id}/opening")
def own_opening(team_id: str, db: Db, user: CurrentUser):
    authorize(db, user, require_team(db, team_id), "lead")
    opening = db.get(TeamOpening, team_id)
    return {"open": live(opening), "summary": opening.summary if opening else "",
            "roles": json.loads(opening.roles_json) if opening else [], "commitment": opening.commitment if opening else ""}


@router.get("/v1/classes/{class_id}/openings")
def list_openings(class_id: str, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id)
    rows = db.execute(select(TeamOpening, Team, Assignment).join(Team, Team.id == TeamOpening.team_id)
                      .join(Assignment, Assignment.id == Team.assignment_id)
                      .where(Assignment.course_id == class_id, TeamOpening.closed == "no", TeamOpening.expires_at > now())
                      .order_by(TeamOpening.team_id).limit(100)).all()
    result = []
    for opening, team, assignment in rows:
        if team_archived(db, team):
            continue
        places = team_capacity(team, assignment) - len(_members(db, team.id))
        if places <= 0 or team_for_assignment(db, assignment.id, user.id):
            continue
        request = db.scalar(select(JoinRequest).where(JoinRequest.team_id == team.id, JoinRequest.account_id == user.id))
        result.append({"team_id": team.id, "team_name": team.name, "assignment_title": assignment.title,
                       "summary": opening.summary, "roles": json.loads(opening.roles_json), "commitment": opening.commitment,
                       "places": places, "expires_at": iso(opening.expires_at),
                       "request": request_dict(db, request) if request else None})
    return result


@router.post("/v1/teams/{team_id}/join-requests", status_code=201)
def request_join(team_id: str, body: JoinInput, request: Request, db: Db, user: CurrentUser):
    throttle(db, user.id, request.client.host if request.client else "unknown", namespace="join")
    team = require_team(db, team_id)
    assignment = scope(db, team, user.id)
    opening = db.get(TeamOpening, team.id)
    if not live(opening):
        raise HTTPException(404, "Opening not found")
    if team_for_assignment(db, assignment.id, user.id):
        raise HTTPException(409, "You already have a team for this assignment")
    existing = db.scalar(select(JoinRequest).where(JoinRequest.team_id == team.id, JoinRequest.account_id == user.id))
    if existing:
        # Retries never duplicate a request or extend its expiry.
        return request_dict(db, existing)
    if body.match_snapshot:
        from .matching import validate_match_snapshot
        validate_match_snapshot(db, team, opening, user.id, body.match_snapshot)
    if len(_members(db, team.id)) >= team_capacity(team, assignment):
        raise HTTPException(409, "This project is full")
    if db.scalar(select(func.count()).select_from(JoinRequest).where(JoinRequest.account_id == user.id, JoinRequest.created_at > now() - timedelta(days=1))) >= 20:
        raise HTTPException(429, "Daily join request limit reached")
    row = JoinRequest(team_id=team.id, account_id=user.id, note=body.note.strip(), expires_at=now() + timedelta(hours=48))
    db.add(row)
    db.flush()
    emit(db, team.id, "join_request.created", user.id, {"request_id": row.id}, visible_to_user_id=team.lead_user_id)
    db.commit()
    return request_dict(db, row)


@router.get("/v1/teams/{team_id}/join-requests")
def requests(team_id: str, db: Db, user: CurrentUser):
    authorize(db, user, require_team(db, team_id), "lead")
    return [request_dict(db, row) for row in db.scalars(select(JoinRequest).where(JoinRequest.team_id == team_id).order_by(JoinRequest.created_at.desc()).limit(100))]


@router.get("/v1/me/join-requests")
def mine(db: Db, user: CurrentUser):
    return [request_dict(db, row) for row in db.scalars(select(JoinRequest).where(JoinRequest.account_id == user.id).order_by(JoinRequest.created_at.desc()).limit(100))]


@router.post("/v1/join-requests/{request_id}/{decision}")
def decide(request_id: str, decision: str, db: Db, user: CurrentUser):
    if decision not in {"accept", "decline", "cancel"}:
        raise HTTPException(404, "Action not found")
    row = db.get(JoinRequest, request_id)
    if row is None:
        raise HTTPException(404, "Request not found")
    team = require_team(db, row.team_id)
    if decision == "cancel":
        if row.account_id != user.id:
            raise HTTPException(404, "Request not found")
    else:
        authorize(db, user, team, "lead")
    target = {"accept": "accepted", "decline": "declined", "cancel": "cancelled"}[decision]
    if row.status == target:
        return request_dict(db, row)
    if row.status != "pending" or aware(row.expires_at) <= now():
        raise HTTPException(409, "This request is no longer pending")
    if decision == "accept":
        account = db.get(User, row.account_id)
        if account is None or account.disabled:
            raise HTTPException(409, "The student is no longer eligible")
        assignment = scope(db, team, account.id)
        if not live(db.get(TeamOpening, team.id)):
            raise HTTPException(409, "This opening is closed or expired")
        if team_for_assignment(db, assignment.id, account.id):
            raise HTTPException(409, "The student already has a team for this assignment")
        if len(_members(db, team.id)) >= team_capacity(team, assignment):
            raise HTTPException(409, "This project is full")
        _join(db, team, account)
    row.status = target
    emit(db, team.id, "join_request.updated", user.id, {"request_id": row.id, "status": target}, visible_to_user_id=team.lead_user_id)
    db.commit()
    return request_dict(db, row)
