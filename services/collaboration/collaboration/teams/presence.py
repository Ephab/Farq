from __future__ import annotations

import json
import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..identity import CurrentUser
from .common import Db, require_team
from .policy import authorize

# Ephemeral: lost on restart by design (spec §6). Never written to the database.
TTL_SECONDS = 30
TYPING_SECONDS = 5
_clock = time.monotonic
_state: dict[str, dict[str, dict]] = {}

router = APIRouter()


class PresenceUpdate(BaseModel):
    focus: str | None = Field(default=None, max_length=80)


def touch(team_id: str, user_id: str, *, focus: str | None = None, typing: bool = False) -> None:
    at = _clock()
    entry = _state.setdefault(team_id, {}).setdefault(user_id, {"focus": None, "typing_until": 0.0, "seen": at})
    entry["seen"] = at
    if focus is not None:
        entry["focus"] = focus or None
    if typing:
        entry["typing_until"] = at + TYPING_SECONDS


def snapshot(team_id: str, *, include_typing: bool = True) -> list[dict]:
    at = _clock()
    team = _state.get(team_id, {})
    for user_id in [user_id for user_id, entry in team.items() if at - entry["seen"] > TTL_SECONDS]:
        del team[user_id]
    return [
        {"user_id": user_id, "focus": entry["focus"], "typing": include_typing and entry["typing_until"] > at}
        for user_id, entry in sorted(team.items())
    ]


def presence_frame(team_id: str, include_typing: bool) -> str:
    return f"event: presence\ndata: {json.dumps(snapshot(team_id, include_typing=include_typing))}\n\n"


@router.post("/v1/teams/{team_id}/presence")
def update_presence(team_id: str, body: PresenceUpdate, db: Db, user: CurrentUser) -> dict:
    authorize(db, user, require_team(db, team_id), "write")
    touch(team_id, user.id, focus=body.focus if body.focus is not None else "")
    return {"ok": True}


@router.post("/v1/teams/{team_id}/typing")
def update_typing(team_id: str, db: Db, user: CurrentUser) -> dict:
    authorize(db, user, require_team(db, team_id), "write")
    touch(team_id, user.id, typing=True)
    return {"ok": True}
