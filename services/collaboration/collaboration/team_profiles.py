"""Team consent is independent of class discovery consent."""
import json
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, delete, select
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .identity import CurrentUser, User
from .models import now, uid
from .profiles import ProfileBody, PublishInput, VersionInput
from .teams.common import Db, iso, require_team
from .teams.events import emit
from .teams.models import TeamMember
from .teams.policy import authorize


class TeamProfile(Base):
    __tablename__ = "team_shared_profiles"
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    body_json: Mapped[str] = mapped_column(Text, default="{}")
    version: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    discovery: Mapped[bool] = mapped_column(Boolean, default=False)


class TeamConsentAudit(Base):
    __tablename__ = "team_profile_consent_audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamPublishInput(PublishInput):
    # Required explicit choice; publishing for teammates never implies discovery.
    discovery: bool


router = APIRouter()


def record(db, row, action, actor_id):
    db.add(TeamConsentAudit(team_id=row.team_id, account_id=row.account_id, version=row.version, action=action))
    db.execute(delete(TeamConsentAudit).where(TeamConsentAudit.created_at < now() - timedelta(days=90)))
    # Never put profile bodies in the replay log.
    emit(db, row.team_id, "profile.updated", actor_id, {"account_id": row.account_id, "version": row.version})


def withdraw_member(db, team_id, account_id, actor_id, action="membership_end"):
    row = db.get(TeamProfile, (team_id, account_id))
    if row and row.published_at:
        row.body_json, row.published_at, row.discovery = "{}", None, False
        row.version += 1
        record(db, row, action, actor_id)


def value(row):
    return {"version": row.version if row else 0, "published": bool(row and row.published_at),
            "discovery": bool(row and row.published_at and row.discovery),
            "profile": json.loads(row.body_json) if row and row.published_at else ProfileBody().model_dump()}


@router.get("/v1/teams/{team_id}/profile")
def own(team_id: str, db: Db, user: CurrentUser):
    authorize(db, user, require_team(db, team_id), "view_chat")
    return value(db.get(TeamProfile, (team_id, user.id)))


@router.put("/v1/teams/{team_id}/profile")
def publish(team_id: str, body: TeamPublishInput, db: Db, user: CurrentUser):
    team = require_team(db, team_id)
    authorize(db, user, team, "view_chat")
    if body.discovery and not team.assignment_id:
        raise HTTPException(422, "Only class projects support opening discovery")
    if body.discovery:
        from .profiles import classroom
        from .teams.models import Assignment
        classroom(db, db.get(Assignment, team.assignment_id).course_id, user.id)
    row = db.get(TeamProfile, (team_id, user.id))
    if body.expected_version != (row.version if row else 0):
        raise HTTPException(409, "Profile changed; review the latest version")
    if row is None:
        row = TeamProfile(team_id=team_id, account_id=user.id, version=0)
        db.add(row)
    clean = body.profile.model_dump()
    for key in ("skills", "roles", "interests", "goals", "languages"):
        clean[key] = list(dict.fromkeys(item.strip() for item in clean[key] if item.strip()))
    clean["meeting_slots"] = sorted(set(clean["meeting_slots"]))
    clean["timezone"], clean["looking"] = clean["timezone"].strip(), False
    row.body_json, row.published_at, row.discovery = json.dumps(clean, ensure_ascii=False), now(), body.discovery
    row.version += 1
    record(db, row, "publish", user.id)
    db.commit()
    return value(row)


@router.post("/v1/teams/{team_id}/profile/withdraw")
def withdraw(team_id: str, body: VersionInput, db: Db, user: CurrentUser):
    authorize(db, user, require_team(db, team_id), "view_chat")
    row = db.get(TeamProfile, (team_id, user.id))
    if body.expected_version != (row.version if row else 0):
        raise HTTPException(409, "Profile changed; reload before withdrawing")
    withdraw_member(db, team_id, user.id, user.id, "withdraw")
    db.commit()
    return value(row)


@router.get("/v1/teams/{team_id}/profiles")
def teammates(team_id: str, db: Db, user: CurrentUser):
    authorize(db, user, require_team(db, team_id), "view_chat")
    rows = db.execute(select(TeamProfile, User).join(User, User.id == TeamProfile.account_id)
                      .join(TeamMember, (TeamMember.team_id == TeamProfile.team_id) & (TeamMember.user_id == User.id))
                      .where(TeamProfile.team_id == team_id, TeamProfile.published_at.is_not(None), User.disabled.is_(False))).all()
    return [{"account_id": account.id, "display_name": account.display_name, "published_at": iso(row.published_at), **value(row)} for row, account in rows]
