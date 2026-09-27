from __future__ import annotations

import hashlib
import json
import os
import time
from urllib.parse import urlparse

from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from .models import MailSession

COOKIE = "waypoint_outlook_session"
CONSENT_COOKIE = "waypoint_outlook_consent"
TOKEN_TENANT = "public:temporary"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def origin() -> str:
    value = os.getenv("OUTLOOK_APP_ORIGIN", "http://localhost:5173").rstrip("/")
    parsed = urlparse(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path or parsed.username
            or parsed.query or parsed.fragment or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1"})):
        raise HTTPException(503, "Configure a valid OUTLOOK_APP_ORIGIN")
    return value


def encryption_key() -> bytes:
    key = os.getenv("WAYPOINT_TOKEN_ENCRYPTION_KEY", "").strip().encode()
    try:
        Fernet(key)
    except (ValueError, TypeError):
        raise HTTPException(503, "Run setup.bat or setup.sh to generate local credentials.") from None
    return key


def seal(value: str) -> str:
    return Fernet(encryption_key()).encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    return Fernet(encryption_key()).decrypt(value.encode()).decode()


def session_user(request: Request, db: Session):
    from ..identity import User
    from . import desktop
    token = request.cookies.get(COOKIE, "")
    session = db.get(MailSession, digest(token)) if token else None
    if session is None or session.expires <= time.time():
        return None
    user = db.get(User, session.user_id)
    if user and user.source == "outlook-desktop":
        if not desktop.enabled():
            return None
        desktop.require_local(request)
    return user


def require_origin(request: Request) -> None:
    if request.headers.get("origin") != origin():
        raise HTTPException(403, "Request origin does not match this Waypoint installation")


def token_for(connection) -> tuple[str, str]:
    if connection.tenant != TOKEN_TENANT:
        raise ValueError("reauthorization_required")
    stored = json.loads(unseal(connection.token_cache))
    if stored["expires"] <= time.time():
        raise ValueError("reauthorization_required")
    return stored["access_token"], connection.token_cache
