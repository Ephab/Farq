"""Sealed Blackboard secrets. Nothing here is returned by a route, logged, or given to Hermes.

The password and the browser session (cookies) are Fernet-sealed with WAYPOINT_TOKEN_ENCRYPTION_KEY,
the key that already protects Graph tokens. Without a key the password is never kept and the
session lives in this process only. See docs/blackboard-threat-model.md.
"""
from __future__ import annotations

import json
import threading

from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from ..models import BlackboardConnection
from ..outlook.auth import encryption_key, seal, unseal

_lock = threading.Lock()
_volatile_sessions: dict[str, dict] = {}


def can_remember() -> bool:
    try:
        encryption_key()
    except HTTPException:
        return False
    return True


def _open(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return unseal(value)
    except (InvalidToken, HTTPException, ValueError):
        return None  # rotated or missing key: treat as not saved


def remember_password(conn: BlackboardConnection, password: str) -> None:
    conn.password_enc = seal(password)


def saved_password(conn: BlackboardConnection) -> str | None:
    return _open(conn.password_enc)


def forget_password(conn: BlackboardConnection) -> None:
    conn.password_enc = None


def save_session(conn: BlackboardConnection, state: dict) -> None:
    if can_remember():
        conn.session_enc = seal(json.dumps(state))
        return
    with _lock:
        _volatile_sessions[conn.student_id] = state


def saved_session(conn: BlackboardConnection) -> dict | None:
    opened = _open(conn.session_enc)
    if opened:
        try:
            return json.loads(opened)
        except json.JSONDecodeError:
            return None
    with _lock:
        return _volatile_sessions.get(conn.student_id)


def clear_session(conn: BlackboardConnection) -> None:
    conn.session_enc = None
    with _lock:
        _volatile_sessions.pop(conn.student_id, None)
