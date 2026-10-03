"""Settings > Connectors: the Waypoint data sources Hermes can read, and the student's switch for each.

Hermes never gets a browser, generic web or MCP tool (AGENTS.md); its "connectors" are Waypoint's
own normalized caches behind bounded `waypoint_*` tools. A student may turn any of them off for
Hermes. That is enforced here, at the internal tool endpoints, not only in the prompt: an "off"
connector's tools answer 403 with a sentence Hermes can relay.

Outlook mail is listed for completeness, but its switch stays in the Emails panel, where the
per-session Coach consent and its capability tokens already live (see outlook/coach.py).
"""
from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import get_db
from .internal_auth import require_internal
from .models import BlackboardContentItem, BlackboardCourse, CoopPosting, Opportunity
from .ownership import OwnedStudent
from .student_memory import disabled_connectors, set_connector
from .tool_grants import READ, HermesToolGrant, check_grant

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]

# id -> (plain name used in tool refusals, Hermes tools it backs, student can switch it here)
CONNECTORS: dict[str, tuple[str, tuple[str, ...], bool]] = {
    "blackboard": ("course materials (Blackboard snapshot)", (
        "waypoint_blackboard_list_courses", "waypoint_blackboard_list_content", "waypoint_blackboard_search",
        "waypoint_blackboard_read_item", "waypoint_blackboard_list_updates"), True),
    "hackathons": ("Saudi hackathons (Hackathonat)", ("waypoint_find_hackathons",), True),
    "coop": ("co-op companies and postings", (
        "waypoint_find_coop_companies", "waypoint_find_coop_postings", "waypoint_get_coop_target"), True),
    "learning_reddit": ("Reddit learning updates", ("waypoint_find_learning_updates", "waypoint_get_learning_update"), True),
    "learning_x": ("X learning updates", ("waypoint_find_learning_updates", "waypoint_get_learning_update"), True),
    "outlook": ("Outlook mail", ("waypoint_search_mail", "waypoint_read_mail"), False),
}


def connector_dependency(connector_id: str):
    """Internal token + a READ grant + the student has not switched this connector off."""
    label = CONNECTORS[connector_id][0]

    def dependency(
        db: Db,
        _internal: Annotated[None, Depends(require_internal)],
        x_waypoint_grant: Annotated[str | None, Header()] = None,
    ) -> HermesToolGrant:
        grant = check_grant(db, x_waypoint_grant, READ)
        if connector_id in disabled_connectors(db, grant.student_id):
            raise HTTPException(403, f"The student turned off Hermes access to {label}. "
                                     "Say so, and that they can turn it back on in Settings > Connectors.")
        return grant

    return dependency


BlackboardGrant = Annotated[HermesToolGrant, Depends(connector_dependency("blackboard"))]
HackathonsGrant = Annotated[HermesToolGrant, Depends(connector_dependency("hackathons"))]
CoopGrant = Annotated[HermesToolGrant, Depends(connector_dependency("coop"))]


def connectors_note(db: Session, student_id: str) -> str:
    """One line for run instructions so Hermes does not waste a call on a connector that is off."""
    off = sorted(cid for cid in disabled_connectors(db, student_id) if cid in CONNECTORS and CONNECTORS[cid][2])
    if not off:
        return ""
    names = "; ".join(f"{CONNECTORS[cid][0]} ({', '.join(CONNECTORS[cid][1])})" for cid in off)
    return f"The student turned these connectors off for you, so do not call their tools: {names}."


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _status(db: Session, student_id: str, connector_id: str) -> dict:
    if connector_id == "blackboard":
        courses = db.scalar(select(func.count()).select_from(BlackboardCourse).where(BlackboardCourse.student_id == student_id)) or 0
        items, updated = db.execute(
            select(func.count(BlackboardContentItem.id), func.max(BlackboardContentItem.modified_at))
            .join(BlackboardCourse, BlackboardContentItem.course_id == BlackboardCourse.id)
            .where(BlackboardCourse.student_id == student_id)
        ).one()
        return {"available": courses > 0, "counts": {"courses": courses, "items": items or 0}, "updated_at": _iso(updated)}
    if connector_id == "hackathons":
        count, updated = db.execute(
            select(func.count(Opportunity.id), func.max(Opportunity.fetched_at)).where(Opportunity.active.is_(True), Opportunity.hidden.is_(False))
        ).one()
        return {"available": (count or 0) > 0, "counts": {"opportunities": count or 0}, "updated_at": _iso(updated)}
    if connector_id == "coop":
        count, updated = db.execute(select(func.count(CoopPosting.id), func.max(CoopPosting.fetched_at)).where(CoopPosting.active.is_(True))).one()
        return {"available": (count or 0) > 0, "counts": {"postings": count or 0}, "updated_at": _iso(updated)}
    if connector_id in {"learning_reddit", "learning_x"}:
        from .learning_updates.service import feed
        items = feed(db, student_id, connector_id.removeprefix("learning_"), limit=50)
        return {"available": bool(items), "counts": {"items": len(items)},
                "updated_at": max((p["fetched_at"] for p in items), default=None)}
    from .outlook.models import MailConnection, MailSession
    connection = db.scalar(select(MailConnection).where(MailConnection.user_id == student_id))
    coach = db.scalar(select(func.count()).select_from(MailSession).where(
        MailSession.user_id == student_id, MailSession.coach_access.is_(True), MailSession.expires > time.time())) or 0
    connected = connection is not None and bool(connection.connected)
    return {"available": connected, "counts": {}, "updated_at": None, "coach_access": connected and coach > 0}


def _listing(db: Session, student_id: str) -> dict:
    off = disabled_connectors(db, student_id)
    return {"connectors": [
        {"id": cid, "tools": list(tools), "switchable": switchable, "enabled": cid not in off, **_status(db, student_id, cid)}
        for cid, (_label, tools, switchable) in CONNECTORS.items()
    ]}


class ConnectorInput(BaseModel):
    enabled: bool


@router.get("/api/students/{student_id}/connectors")
def list_connectors(student: OwnedStudent, db: Db) -> dict:
    return _listing(db, student.id)


@router.put("/api/students/{student_id}/connectors/{connector_id}")
def update_connector(connector_id: str, body: ConnectorInput, student: OwnedStudent, db: Db) -> dict:
    if connector_id not in CONNECTORS:
        raise HTTPException(404, "Unknown connector")
    if not CONNECTORS[connector_id][2]:
        raise HTTPException(422, "Coach access to mail is managed in the Emails panel")
    set_connector(db, student.id, connector_id, body.enabled)
    db.commit()
    return _listing(db, student.id)
