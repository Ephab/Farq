"""Explicit class-scoped profile consent. No personal facts or automatic publication."""
from datetime import datetime, timedelta
import json
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, delete, select
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .identity import CurrentUser, User
from .invitations import classroom as require_class
from .models import now, uid
from .teams.common import Db, iso
from .teams.models import CourseEnrollment


class SharedProfile(Base):
    __tablename__ = "shared_profiles"
    class_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    body_json: Mapped[str] = mapped_column(Text, default="{}")
    version: Mapped[int] = mapped_column(Integer, default=0)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ConsentAudit(Base):
    __tablename__ = "profile_consent_audit"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    class_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DiscoveryPreference(Base):
    __tablename__ = "discovery_preferences"
    class_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    body_json: Mapped[str] = mapped_column(Text, default="{}")


Tag = Annotated[str, Field(min_length=1, max_length=80)]
Slot = Annotated[int, Field(strict=True, ge=0, le=167)]


class ProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    skills: list[Tag] = Field(default_factory=list, max_length=12)
    roles: list[Tag] = Field(default_factory=list, max_length=6)
    interests: list[Tag] = Field(default_factory=list, max_length=12)
    goals: list[Tag] = Field(default_factory=list, max_length=6)
    languages: list[Tag] = Field(default_factory=list, max_length=6)
    timezone: str = Field(default="", max_length=80)
    # UTC week: Monday 00:00 = 0, Sunday 23:00 = 167. No guessed time conversion.
    meeting_slots: list[Slot] = Field(default_factory=list, max_length=56)
    hours_per_week: int | None = Field(default=None, strict=True, ge=1, le=40)
    looking: bool = False


class PublishInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewed: Literal[True]
    expected_version: int = Field(ge=0)
    profile: ProfileBody


class VersionInput(BaseModel):
    expected_version: int = Field(ge=0)


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    desired_skills: list[Tag] = Field(default_factory=list, max_length=12)
    required_skills: list[Tag] = Field(default_factory=list, max_length=12)
    required_languages: list[Tag] = Field(default_factory=list, max_length=6)
    min_hours: int | None = Field(default=None, strict=True, ge=1, le=40)
    required_meeting_slots: list[Slot] = Field(default_factory=list, max_length=56)
    team_size: int = Field(default=3, ge=2, le=6)


router = APIRouter()


def classroom(db, class_id, user_id):
    course = require_class(db, class_id, user_id)
    role = db.scalar(select(CourseEnrollment.role).where(CourseEnrollment.course_id == class_id, CourseEnrollment.user_id == user_id))
    if role != "student":
        raise HTTPException(403, "Teammate profiles are for student members")
    return course


def audit(db, row, action):
    db.add(ConsentAudit(class_id=row.class_id, account_id=row.account_id, version=row.version, action=action))
    # Audit holds actions/versions only, never historical profile bodies.
    db.execute(delete(ConsentAudit).where(ConsentAudit.created_at < now() - timedelta(days=90)))


def withdraw(db, row, action="withdraw"):
    if row.published_at is not None:
        row.version += 1
        row.body_json, row.published_at = "{}", None
        audit(db, row, action)
    preference = db.get(DiscoveryPreference, (row.class_id, row.account_id))
    if preference:
        db.delete(preference)


def published_dict(db, row):
    account = db.get(User, row.account_id)
    return {"account_id": row.account_id, "display_name": account.display_name, "version": row.version,
            "published_at": iso(row.published_at), "provenance": "self_described", "profile": json.loads(row.body_json)}


@router.get("/v1/classes/{class_id}/profile")
def own_profile(class_id: str, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id)
    row = db.get(SharedProfile, (class_id, user.id))
    return {"version": row.version if row else 0, "published": bool(row and row.published_at),
            "profile": json.loads(row.body_json) if row and row.published_at else ProfileBody().model_dump()}


@router.put("/v1/classes/{class_id}/profile")
def publish(class_id: str, body: PublishInput, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id)
    row = db.get(SharedProfile, (class_id, user.id))
    if body.expected_version != (row.version if row else 0):
        raise HTTPException(409, "Profile changed; review the latest version before publishing")
    if row is None:
        row = SharedProfile(class_id=class_id, account_id=user.id, version=0)
        db.add(row)
    clean = body.profile.model_dump()
    for key in ("skills", "roles", "interests", "goals", "languages"):
        clean[key] = list(dict.fromkeys(value.strip() for value in clean[key] if value.strip()))
    clean["meeting_slots"] = sorted(set(clean["meeting_slots"]))
    clean["timezone"] = clean["timezone"].strip()
    row.body_json, row.published_at = json.dumps(clean, ensure_ascii=False), now()
    row.version += 1
    audit(db, row, "publish")
    db.commit()
    return published_dict(db, row)


@router.post("/v1/classes/{class_id}/profile/withdraw")
def withdraw_profile(class_id: str, body: VersionInput, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id)
    row = db.get(SharedProfile, (class_id, user.id))
    if body.expected_version != (row.version if row else 0):
        raise HTTPException(409, "Profile changed; reload before withdrawing")
    if row:
        withdraw(db, row)
    db.commit()
    return {"published": False, "version": row.version if row else 0}


@router.get("/v1/classes/{class_id}/profiles/{account_id}")
def read_candidate(class_id: str, account_id: str, db: Db, user: CurrentUser, version: int):
    classroom(db, class_id, user.id)
    own = db.get(SharedProfile, (class_id, user.id))
    row = db.get(SharedProfile, (class_id, account_id))
    enrollment = db.scalar(select(CourseEnrollment).where(CourseEnrollment.course_id == class_id, CourseEnrollment.user_id == account_id))
    account = db.get(User, account_id)
    if not own or not own.published_at or not json.loads(own.body_json).get("looking"):
        raise HTTPException(403, "Publish your profile and opt into discovery first")
    if not row or not row.published_at or row.version != version or not enrollment or enrollment.role != "student" or not account or account.disabled or not json.loads(row.body_json).get("looking"):
        raise HTTPException(404, "Profile is no longer available")
    return published_dict(db, row)


@router.get("/v1/classes/{class_id}/preferences")
def own_preferences(class_id: str, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id)
    row = db.get(DiscoveryPreference, (class_id, user.id))
    return json.loads(row.body_json) if row else Preferences().model_dump()


@router.put("/v1/classes/{class_id}/preferences")
def save_preferences(class_id: str, body: Preferences, db: Db, user: CurrentUser):
    classroom(db, class_id, user.id)
    db.merge(DiscoveryPreference(class_id=class_id, account_id=user.id, body_json=body.model_dump_json()))
    db.commit()
    return body
