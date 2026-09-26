from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from urllib.parse import urlparse
from uuid import UUID

import msal
from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from .models import MailSession

COOKIE = "farq_outlook_session"
FLOW_COOKIE = "farq_outlook_flow"
SCOPES = ["User.Read", "Mail.Read"]


@dataclass(frozen=True)
class Settings:
    client_id: str
    tenant: str
    secret: str
    origin: str
    redirect: str
    key: str

    @property
    def secure(self) -> bool:
        return self.origin.startswith("https://")


def settings() -> Settings:
    values = [os.getenv(name, "").strip() for name in (
        "MICROSOFT_CLIENT_ID", "MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_SECRET",
        "OUTLOOK_APP_ORIGIN", "MICROSOFT_REDIRECT_URI", "FARQ_TOKEN_ENCRYPTION_KEY",
    )]
    if not all(values):
        raise HTTPException(503, "Outlook is not configured. Follow docs/outlook-setup.md on the API server.")
    config = Settings(*values)
    try:
        UUID(config.tenant)
        UUID(config.client_id)
        Fernet(config.key.encode())
        origin, redirect = urlparse(config.origin), urlparse(config.redirect)
        assert origin.scheme in {"http", "https"} and origin.netloc and origin.path in {"", "/"}
        assert not origin.username and not origin.query and not origin.fragment
        assert redirect.path == "/api/outlook/callback" and not redirect.query and not redirect.fragment
        assert (redirect.scheme, redirect.netloc) == (origin.scheme, origin.netloc)
        assert origin.scheme == "https" or origin.hostname in {"localhost", "127.0.0.1"}
    except (ValueError, AssertionError):
        raise HTTPException(503, "Invalid Outlook configuration; check tenant, key and same-origin callback URL.") from None
    return config


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def seal(value: str) -> str:
    return Fernet(settings().key.encode()).encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    return Fernet(settings().key.encode()).decrypt(value.encode()).decode()


def client(cache: msal.SerializableTokenCache | None = None):
    config = settings()
    return msal.ConfidentialClientApplication(
        config.client_id, authority=f"https://login.microsoftonline.com/{config.tenant}",
        client_credential=config.secret, token_cache=cache, timeout=20,
    )


def session_user(request: Request, db: Session):
    from ..identity import User
    token = request.cookies.get(COOKIE, "")
    session = db.get(MailSession, digest(token)) if token else None
    if session is None or session.expires <= time.time():
        return None
    user = db.get(User, session.user_id)
    if user and user.source == "outlook-desktop":
        from . import desktop
        if not desktop.enabled():
            return None
        desktop.require_local(request)
    return user


def require_origin(request: Request) -> None:
    from . import desktop
    expected = desktop.origin() if desktop.enabled() else settings().origin.rstrip("/")
    if desktop.enabled():
        desktop.require_local(request)
    if request.headers.get("origin") != expected:
        raise HTTPException(403, "Request origin does not match this Farq installation")


def token_for(connection) -> tuple[str, str]:
    cache = msal.SerializableTokenCache()
    cache.deserialize(unseal(connection.token_cache))
    app = client(cache)
    accounts = app.get_accounts()
    if not accounts:
        raise ValueError("reauthorization_required")
    result = app.acquire_token_silent(SCOPES, account=accounts[0])
    if not result or "access_token" not in result:
        raise ValueError("reauthorization_required")
    return result["access_token"], seal(cache.serialize())
