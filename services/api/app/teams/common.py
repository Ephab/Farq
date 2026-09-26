from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .models import Team

Db = Annotated[Session, Depends(get_db)]


def aware(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; everything Farq stores is UTC."""
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
    value = aware(value)
    return value.isoformat() if value else None


def loads(text: str | None, default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def require(db: Session, model, item_id: str, label: str):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(404, f"{label} not found")
    return item


def require_team(db: Session, team_id: str) -> Team:
    return require(db, Team, team_id, "Team")
