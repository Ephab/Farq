"""Read-only classmate and team discovery for the personal coach, through the central service.

The student opts in once per sign-in from the Collaboration screen. Opt-in lives only in this
process's memory (restarting the API, signing out or expiry ends it) and records which broker session
signed in. Each coach run then gets an expiring capability, like the mail one in outlook/coach.py.
Every tool call re-checks: capability, the run still running, the run's thread belongs to the same
student, the opt-in is unchanged, and the central bearer token is still obtainable. Central
membership and consent checks run on every call too, so removal or withdrawal denies later calls.

The adapter exposes a fixed set of GET/POST paths with validated ids. Hermes never supplies a URL,
a header or a credential, and no tool here publishes, invites or requests anything. Peer-written
profile text is untrusted data.
"""
from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .database import get_db
from .identity import User, current_user
from .internal_auth import require_internal
from .models import AgentRun, ChatThread

OPT_IN_SECONDS = 2 * 3600
DRAFT_SECONDS = 30 * 60
GRANT_SECONDS = 15 * 60
MAX_RESPONSE_BYTES = 200_000
ID = r"^[A-Za-z0-9_-]{1,64}$"

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(current_user)]

_lock = threading.Lock()
_session_for = None


@dataclass
class OptIn:
    broker: Any
    session: str
    expires: float


@dataclass
class Grant:
    user_id: str
    run_id: str
    session: str
    expires: float


_optins: dict[str, OptIn] = {}
# (student, class) -> (profile fields, expires). A draft is only ever shown to its student for review.
_drafts: dict[tuple[str, str], tuple[dict, float]] = {}
_grants: dict[str, Grant] = {}


def bind(auth_router) -> None:
    """Reuse the sign-in router's loopback, origin and header checks and its broker."""
    global _session_for
    _session_for = auth_router.session_for


def reset() -> None:
    with _lock:
        _optins.clear()
        _grants.clear()
        _drafts.clear()


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _active_optin(user_id: str) -> OptIn | None:
    optin = _optins.get(user_id)
    if optin is not None and optin.expires <= time.time():
        _optins.pop(user_id, None)
        return None
    return optin


def issue_grant(user_id: str, run_id: str) -> str | None:
    """A capability for one coach run, only while the student has opted in this sign-in."""
    with _lock:
        now = time.time()
        for key in [key for key, grant in _grants.items() if grant.expires <= now]:
            del _grants[key]
        optin = _active_optin(user_id)
        if optin is None:
            return None
        token = secrets.token_urlsafe(32)
        _grants[_digest(token)] = Grant(user_id, run_id, optin.session, min(optin.expires, now + GRANT_SECONDS))
        return token


class OptInStatus(BaseModel):
    coach_access: bool
    expires_in: int | None = None


def _status(user_id: str) -> OptInStatus:
    with _lock:
        optin = _active_optin(user_id)
        return OptInStatus(coach_access=bool(optin), expires_in=int(optin.expires - time.time()) if optin else None)


def session_context(request: Request, response: Response):
    """The caller's broker and browser session after the sign-in router's loopback/origin/header checks."""
    return _context(request, response)


def _context(request: Request, response: Response):
    if _session_for is None:
        raise HTTPException(503, "Collaboration is not configured")
    return _session_for(request, response)


# POST, not GET: the sign-in router only trusts requests that carry an Origin header, and a same-origin
# GET sends none. The broker cookie is also scoped to this path prefix, so every route here must stay under it.
@router.post("/api/collaboration/auth/coach/status", response_model=OptInStatus)
def coach_status(request: Request, response: Response, user: CurrentUser):
    _context(request, response)
    return _status(user.id)


@router.post("/api/collaboration/auth/coach", response_model=OptInStatus)
def coach_enable(request: Request, response: Response, user: CurrentUser):
    broker, session = _context(request, response)
    try:
        signed_in = broker.token(session)
    except Exception:
        raise HTTPException(503, "Could not check collaboration sign-in") from None
    if signed_in is None:
        raise HTTPException(401, "Sign in to collaboration first")
    with _lock:
        _optins[user.id] = OptIn(broker, session, time.time() + OPT_IN_SECONDS)
    return _status(user.id)


@router.delete("/api/collaboration/auth/coach", response_model=OptInStatus)
def coach_disable(request: Request, response: Response, user: CurrentUser):
    _context(request, response)
    with _lock:
        _optins.pop(user.id, None)
        for key in [key for key, grant in _grants.items() if grant.user_id == user.id]:
            del _grants[key]
        for key in [key for key in _drafts if key[0] == user.id]:
            del _drafts[key]
    return _status(user.id)


def authorize(token: str, db: Session) -> tuple[OptIn, Grant]:
    with _lock:
        grant = _grants.get(_digest(token))
        optin = _active_optin(grant.user_id) if grant else None
    if grant is None or grant.expires <= time.time():
        raise HTTPException(403, "Collaboration capability expired or unavailable")
    run = db.get(AgentRun, grant.run_id)
    thread = db.get(ChatThread, run.thread_id) if run else None
    if (run is None or run.status != "running" or thread is None or thread.student_id != grant.user_id
            or optin is None or optin.session != grant.session):
        raise HTTPException(403, "Collaboration access revoked or run no longer active")
    return optin, grant


def central(optin: OptIn, grant: Grant, method: str, path: str, *, json: dict | None = None,
            params: dict | None = None) -> dict:
    """One fixed call to the central API as the student. Failures come back as data the coach can relay."""
    try:
        session = optin.broker.token(optin.session)
    except Exception:
        raise HTTPException(503, "Could not refresh collaboration sign-in") from None
    if session is None:
        with _lock:
            _optins.pop(grant.user_id, None)
        raise HTTPException(403, "Collaboration sign-in ended; ask the student to sign in again")
    try:
        response = httpx.request(
            method, optin.broker.config.api_origin + path, json=json, params=params, timeout=10,
            follow_redirects=False, headers={"Authorization": f"Bearer {session['access_token']}"})
    except httpx.HTTPError:
        return {"success": False, "error": "The collaboration service is unavailable right now"}
    if len(response.content) > MAX_RESPONSE_BYTES:
        return {"success": False, "error": "The collaboration service returned too much data"}
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code >= 400:
        detail = body.get("detail") if isinstance(body, dict) else None
        return {"success": False, "status": response.status_code,
                "error": detail if isinstance(detail, str) else "The collaboration service refused this request"}
    return {"success": True, "data": body}


def wrap(result: dict, source: str) -> dict:
    return {"untrusted_peer_data": True, "source": source, **result}


class Access(BaseModel):
    collaboration_access: str = Field(min_length=32, max_length=128)


class ClassInput(Access):
    class_id: str = Field(pattern=ID)


class AssignmentInput(ClassInput):
    assignment_id: str = Field(pattern=ID)


Tag = Annotated[str, Field(min_length=1, max_length=80)]


class ProfileDraft(BaseModel):
    """The reviewable fields only. There is deliberately no `looking`: joining discovery is the student's own act."""

    model_config = ConfigDict(extra="forbid")
    skills: list[Tag] = Field(default_factory=list, max_length=12)
    roles: list[Tag] = Field(default_factory=list, max_length=6)
    interests: list[Tag] = Field(default_factory=list, max_length=12)
    goals: list[Tag] = Field(default_factory=list, max_length=6)
    languages: list[Tag] = Field(default_factory=list, max_length=6)
    timezone: str = Field(default="", max_length=80)
    meeting_slots: list[Annotated[int, Field(strict=True, ge=0, le=167)]] = Field(default_factory=list, max_length=56)
    hours_per_week: int | None = Field(default=None, strict=True, ge=1, le=40)


class DraftInput(ClassInput):
    profile: ProfileDraft


class DraftFetch(BaseModel):
    class_id: str = Field(pattern=ID)


class CandidateInput(ClassInput):
    account_id: str = Field(pattern=ID)
    version: int = Field(ge=1, le=1_000_000)


def _call(body: Access, db: Session, method: str, path: str, source: str, **kwargs) -> dict:
    optin, grant = authorize(body.collaboration_access, db)
    return wrap(central(optin, grant, method, path, **kwargs), source)


@router.post("/internal/hermes/collaboration/classes", dependencies=[Depends(require_internal)])
def coach_classes(body: Access, db: Db):
    return _call(body, db, "GET", "/v1/classes", "Student's classes")


@router.post("/internal/hermes/collaboration/class", dependencies=[Depends(require_internal)])
def coach_class(body: ClassInput, db: Db):
    return _call(body, db, "GET", f"/v1/classes/{body.class_id}", "One class and its assignments")


@router.post("/internal/hermes/collaboration/my-discovery", dependencies=[Depends(require_internal)])
def coach_my_discovery(body: ClassInput, db: Db):
    optin, grant = authorize(body.collaboration_access, db)
    profile = central(optin, grant, "GET", f"/v1/classes/{body.class_id}/profile")
    preferences = central(optin, grant, "GET", f"/v1/classes/{body.class_id}/preferences")
    return wrap({"success": profile["success"] and preferences["success"], "profile": profile, "preferences": preferences},
                "The student's own published profile and private matching preferences")


@router.post("/internal/hermes/collaboration/teammates", dependencies=[Depends(require_internal)])
def coach_teammates(body: AssignmentInput, db: Db):
    return _call(body, db, "POST", f"/v1/classes/{body.class_id}/discovery/matches",
                 "Whole-team suggestions (fit-v1); no seats reserved", json={"assignment_id": body.assignment_id})


@router.post("/internal/hermes/collaboration/teams", dependencies=[Depends(require_internal)])
def coach_teams(body: AssignmentInput, db: Db):
    result = _call(body, db, "POST", f"/v1/classes/{body.class_id}/discovery/team-matches",
                   "Existing teams with open places (fit-v1); no places reserved",
                   json={"assignment_id": body.assignment_id})
    # The snapshot only authorizes a join request, which the student makes in the app.
    for team in (result.get("data") or {}).get("teams", []) if result.get("success") else []:
        team.pop("snapshot", None)
    return result


@router.post("/internal/hermes/collaboration/candidate", dependencies=[Depends(require_internal)])
def coach_candidate(body: CandidateInput, db: Db):
    return _call(body, db, "GET", f"/v1/classes/{body.class_id}/profiles/{body.account_id}",
                 "A classmate's published, self-described profile", params={"version": body.version})


@router.post("/internal/hermes/collaboration/draft-profile", dependencies=[Depends(require_internal)])
def coach_draft_profile(body: DraftInput, db: Db):
    """Stage a profile draft for the student to review. Publishes nothing, never sets `looking`."""
    optin, grant = authorize(body.collaboration_access, db)
    member = central(optin, grant, "GET", f"/v1/classes/{body.class_id}/profile")
    if not member["success"]:
        return wrap(member, "Draft not saved: the student is not in this class")
    with _lock:
        now = time.time()
        for key in [key for key, (_, expires) in _drafts.items() if expires <= now]:
            del _drafts[key]
        _drafts[(grant.user_id, body.class_id)] = (body.profile.model_dump(), now + DRAFT_SECONDS)
    return {"success": True, "note": "Draft saved. The student sees it in Group Projects > Profile and must review and publish it themselves."}


@router.post("/api/collaboration/auth/coach/draft")
def coach_draft(body: DraftFetch, request: Request, response: Response, user: CurrentUser):
    """The student's own page asks for the draft once; it is removed when read."""
    _context(request, response)
    with _lock:
        entry = _drafts.pop((user.id, body.class_id), None)
    if entry is None or entry[1] <= time.time():
        return {"draft": None}
    return {"draft": entry[0]}
