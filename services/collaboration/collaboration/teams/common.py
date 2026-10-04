from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .models import Team, Assignment, Course

Db = Annotated[Session, Depends(get_db)]


def aware(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; everything Waypoint stores is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def utc(value: datetime | None) -> datetime | None:
    """Normalise an incoming datetime to UTC before storage: SQLite keeps the
    wall-clock time and drops the offset, so "10:00+03:00" must become 07:00Z."""
    if value is None:
        return None
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def iso(value: datetime | None) -> str | None:
    # Always UTC: PostgreSQL returns the session time zone, a fresh row has UTC, and clients compare these strings.
    value = aware(value)
    return value.astimezone(timezone.utc).isoformat() if value else None


def loads(text: str | None, default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def project_dict(team: Team) -> dict:
    """The team's own brief, deliverables and rubric; empty where the assignment's apply."""
    return {"brief": loads(team.brief_json, {}), "deliverables": loads(team.deliverables_json, []), "rubric": loads(team.rubric_json, [])}


def lock_for_write(db: Session) -> None:
    """Take SQLite's write lock before a read-check-write, so two requests can't
    both read the same state and both act on it (e.g. two votes applying twice)."""
    if db.get_bind().dialect.name != "sqlite":
        return
    raw = db.connection().connection.dbapi_connection
    if not raw.in_transaction:
        raw.execute("BEGIN IMMEDIATE")


def require(db: Session, model, item_id: str, label: str):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(404, f"{label} not found")
    return item


def require_team(db: Session, team_id: str) -> Team:
    team = require(db, Team, team_id, "Team")
    if team_archived(db, team):
        raise HTTPException(404, "Project is archived")
    return team


def team_archived(db: Session, team: Team) -> bool:
    if team.archived_at:
        return True
    assignment = db.get(Assignment, team.assignment_id) if team.assignment_id else None
    course = db.get(Course, assignment.course_id) if assignment else None
    return bool(course and course.archived_at)
