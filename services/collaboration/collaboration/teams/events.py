from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import team_session
from ..identity import CurrentUser, User
from .common import Db, iso, loads, require_team
from .models import TeamEvent, TeamMember
from .policy import authorize
from .presence import snapshot, touch

# Event types an instructor must never receive (spec §5: the chat is private).
CHAT_PREFIXES = ("message.", "reaction.", "typing.", "hermes.", "profile.")
POLL_SECONDS = 0.4
HEARTBEAT_SECONDS = 15
PRESENCE_SECONDS = 2
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


def visible_to(event: TeamEvent, user_id: str, role: str) -> bool:
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
    return [row for row in rows if visible_to(row, user_id, role)], cursor


def event_dict(event: TeamEvent) -> dict:
    return {
        "seq": event.seq, "type": event.type, "actor_user_id": event.actor_user_id,
        "payload": loads(event.payload_json, {}), "created_at": iso(event.created_at),
    }


def sse_frame(event: TeamEvent) -> str:
    return f"id: {event.seq}\nevent: {event.type}\ndata: {json.dumps(event_dict(event), ensure_ascii=False)}\n\n"


@router.get("/v1/teams/{team_id}/events/replay")
def replay(team_id: str, db: Db, user: CurrentUser, after: int = Query(default=0, ge=0)):
    role = authorize(db, user, require_team(db, team_id), "view")
    rows, cursor = events_after(db, team_id, after, user.id, role)
    return {"events": [event_dict(row) for row in rows], "cursor": cursor}


@router.get("/v1/teams/{team_id}/events")
def stream_events(team_id: str, request: Request, db: Db, user: CurrentUser,
                  after: int = Query(default=0, ge=0), last_event_id: Annotated[str | None, Header()] = None):
    authorize(db, user, require_team(db, team_id), "view")
    db.commit()  # Never hold the transaction/advisory lock while a response streams.
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    sessions, expires = request.app.state.sessions, request.state.auth_expires
    user_id = user.id

    def stream():
        cursor, polls, last_beat, last_presence = start, 0, time.monotonic(), 0.0
        yield "retry: 2000\n\n"
        while time.time() < expires:
            with team_session(sessions) as session:
                account = session.get(User, user_id)
                if account is None or account.disabled:
                    return
                try:
                    role = authorize(session, account, require_team(session, team_id), "view")
                except HTTPException:
                    return
                rows, cursor = events_after(session, team_id, cursor, user_id, role)
                frames = [sse_frame(row) for row in rows]
                if time.monotonic() - last_presence >= PRESENCE_SECONDS:
                    member_ids = set(session.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team_id)))
                    if role != "instructor":
                        touch(team_id, user_id)
                    present = [entry for entry in snapshot(team_id, include_typing=role != "instructor")
                               if entry["user_id"] in member_ids]
                    frames.append(f"event: presence\ndata: {json.dumps(present)}\n\n")
                    last_presence = time.monotonic()
            yield from frames
            if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                yield ": keep-alive\n\n"
                last_beat = time.monotonic()
            polls += 1
            if MAX_POLLS is not None and polls >= MAX_POLLS:
                return
            time.sleep(POLL_SECONDS)
        # Client reconnects using a freshly refreshed token and its last event ID.

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


