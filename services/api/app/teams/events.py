from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..identity import resolve_user
from .common import Db, iso, loads, require_team
from .models import TeamEvent
from .policy import authorize

# Event types an instructor must never receive (spec §5: the chat is private).
CHAT_PREFIXES = ("message.", "reaction.", "typing.")
POLL_SECONDS = 0.4
HEARTBEAT_SECONDS = 15
# Tests set this to stop the otherwise endless stream after N polls.
MAX_POLLS: int | None = None

router = APIRouter()


def emit(
    db: Session,
    team_id: str,
    type_: str,
    actor_user_id: str | None,
    payload: dict,
    *,
    visible_to_user_id: str | None = None,
    created_at: datetime | None = None,
) -> TeamEvent:
    """Add one event in the caller's transaction (transactional outbox)."""
    event = TeamEvent(
        team_id=team_id, type=type_, actor_user_id=actor_user_id, visible_to_user_id=visible_to_user_id,
        payload_json=json.dumps(payload, ensure_ascii=False, default=str),
    )
    if created_at is not None:
        event.created_at = created_at
    db.add(event)
    db.flush()
    return event


def _visible(event: TeamEvent, user_id: str, role: str) -> bool:
    if event.visible_to_user_id and event.visible_to_user_id != user_id:
        return False
    if role == "instructor" and (event.type.startswith(CHAT_PREFIXES) or event.visible_to_user_id):
        return False
    return True


def events_after(db: Session, team_id: str, after_seq: int, user_id: str, role: str, limit: int = 200) -> tuple[list[TeamEvent], int]:
    rows = db.scalars(
        select(TeamEvent).where(TeamEvent.team_id == team_id, TeamEvent.seq > after_seq).order_by(TeamEvent.seq).limit(limit)
    ).all()
    cursor = rows[-1].seq if rows else after_seq
    return [row for row in rows if _visible(row, user_id, role)], cursor


def event_dict(event: TeamEvent) -> dict:
    return {
        "seq": event.seq, "type": event.type, "actor_user_id": event.actor_user_id,
        "payload": loads(event.payload_json, {}), "created_at": iso(event.created_at),
    }


def sse_frame(event: TeamEvent) -> str:
    return f"id: {event.seq}\nevent: {event.type}\ndata: {json.dumps(event_dict(event), ensure_ascii=False)}\n\n"


@router.get("/api/teams/{team_id}/events")
def team_event_stream(
    team_id: str,
    db: Db,
    as_user: Annotated[str | None, Query(alias="as")] = None,
    after: int = 0,
    last_event_id: Annotated[str | None, Header()] = None,
):
    # EventSource cannot send headers, so the demo stream names its viewer in
    # the query. Microsoft sign-in will replace this with the session cookie.
    user = resolve_user(db, as_user)
    if user is None:
        raise HTTPException(401, "Choose who you are with the View as switcher")
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    user_id = user.id

    def stream():
        cursor, polls, last_beat = start, 0, time.monotonic()
        yield "retry: 2000\n\n"
        while True:
            session = SessionLocal()
            try:
                rows, cursor = events_after(session, team_id, cursor, user_id, role)
                frames = [sse_frame(row) for row in rows]
            finally:
                session.close()
            yield from frames
            if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                yield ": keep-alive\n\n"
                last_beat = time.monotonic()
            polls += 1
            if MAX_POLLS is not None and polls >= MAX_POLLS:
                return
            time.sleep(POLL_SECONDS)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
