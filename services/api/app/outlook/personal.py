"""Public-client Graph sign-in using browser-bound flows and the shared mailbox cache."""
from __future__ import annotations

import json
import os
import secrets
import time
from urllib.parse import urlparse
from uuid import UUID

import httpx
from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update

from ..identity import User
from ..models import uid
from . import auth
from .models import MailConnection, MailSession, OAuthAttempt
from .router import Db, router

SCOPES = "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access openid profile"
PUBLIC_COOKIE = "farq_outlook_public_flow"


def origin() -> str:
    value = os.getenv("OUTLOOK_APP_ORIGIN", "http://localhost:5173").rstrip("/")
    parsed = urlparse(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path or parsed.username
            or parsed.query or parsed.fragment or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1"})):
        raise HTTPException(503, "Configure a valid OUTLOOK_APP_ORIGIN")
    return value


def require_origin(request):
    if request.headers.get("origin") != origin():
        raise HTTPException(403, "Request origin does not match this Farq installation")
    auth.encryption_key()


def client_config():
    client_id = os.getenv("OUTLOOK_CLIENT_ID", "").strip()
    tenant = os.getenv("OUTLOOK_TENANT", "consumers").strip() or "consumers"
    try:
        UUID(client_id)
        if tenant not in {"consumers", "organizations", "common"}:
            UUID(tenant)
    except ValueError:
        raise HTTPException(503, "Configure OUTLOOK_CLIENT_ID and OUTLOOK_TENANT for device sign-in") from None
    return client_id, tenant


def microsoft_post(tenant, path, data):
    try:
        response = httpx.post(f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/{path}", data=data, timeout=20, follow_redirects=False)
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError()
        return response.status_code, payload
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Microsoft sign-in is unavailable") from None


@router.get("/personal/config")
def config(response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        auth.encryption_key()
        origin()
    except HTTPException:
        return {"available": False, "device": False}
    try:
        client_config()
        device = True
    except HTTPException:
        device = False
    return {"available": True, "device": device}


class DeviceConsent(BaseModel):
    accepted: bool


@router.post("/personal/device/start")
def start(body: DeviceConsent, request: Request, response: Response, db: Db):
    require_origin(request)
    if not body.accepted:
        raise HTTPException(403, "Accept mailbox access first")
    client_id, tenant = client_config()
    status, flow = microsoft_post(tenant, "devicecode", {"client_id": client_id, "scope": SCOPES})
    if status != 200 or not flow.get("device_code"):
        raise HTTPException(502, "Microsoft rejected device sign-in")
    token = secrets.token_urlsafe(32)
    old = request.cookies.get(PUBLIC_COOKIE, "")
    db.execute(delete(OAuthAttempt).where(OAuthAttempt.state_hash == auth.digest(old)))
    db.execute(delete(OAuthAttempt).where(OAuthAttempt.expires < time.time()))
    interval = max(5, int(flow.get("interval", 5)))
    expires = min(900, int(flow.get("expires_in", 900)))
    flow.update(client_id=client_id, tenant=tenant, interval=interval, next_poll=time.time() + interval)
    db.add(OAuthAttempt(state_hash=auth.digest(token), browser_hash=auth.digest(token), flow=auth.seal(json.dumps(flow)), expires=time.time() + expires))
    db.commit()
    response.set_cookie(PUBLIC_COOKIE, token, max_age=expires, httponly=True, secure=origin().startswith("https"), samesite="strict", path="/api/outlook")
    return {"user_code": flow.get("user_code", ""), "verification_uri": "https://microsoft.com/devicelogin", "interval": interval, "expires_in": expires}


def connect_tokens(payload, tenant, client_id, request, response, db):
    access = str(payload.get("access_token", ""))
    if len(access) < 16:
        raise HTTPException(401, "Microsoft did not return a usable access token")
    try:
        result = httpx.get("https://graph.microsoft.com/v1.0/me", params={"$select": "id,displayName,mail,userPrincipalName"}, headers={"Authorization": f"Bearer {access}"}, timeout=20, follow_redirects=False)
        result.raise_for_status()
        profile = result.json()
        if not profile.get("id"):
            raise ValueError()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(401, "Microsoft rejected the token. User.Read and Mail.Read consent are required.") from None
    namespace = "public:" + tenant
    connection = db.scalar(select(MailConnection).where(MailConnection.tenant == namespace, MailConnection.account_id == profile["id"]))
    if connection is None:
        user = User(id=uid(), display_name=str(profile.get("displayName") or "Outlook")[:120], source="microsoft")
        db.add(user)
        db.flush()
        connection = MailConnection(user_id=user.id, tenant=namespace, account_id=profile["id"], label="")
        db.add(connection)
        db.flush()
    connection.label = str(profile.get("mail") or profile.get("userPrincipalName") or "Outlook")[:200]
    connection.token_cache = auth.seal(json.dumps({"access_token": access, "refresh_token": payload.get("refresh_token", ""), "expires": time.time() + max(0, int(payload.get("expires_in", 3000)) - 120), "client_id": client_id, "tenant": tenant}))
    connection.connected, connection.status, connection.error = True, "queued", ""
    connection.generation += 1
    connection.next_sync, connection.lease_until, connection.lease_id = 0, 0, ""
    token = secrets.token_urlsafe(32)
    db.execute(delete(MailSession).where(MailSession.token_hash == auth.digest(request.cookies.get(auth.COOKIE, ""))))
    db.add(MailSession(token_hash=auth.digest(token), user_id=connection.user_id, expires=time.time() + 7 * 86400))
    db.commit()
    response.set_cookie(auth.COOKIE, token, max_age=7 * 86400, httponly=True, secure=origin().startswith("https"), samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    response.delete_cookie(PUBLIC_COOKIE, path="/api/outlook")
    return {"connected": True}


@router.post("/personal/device/poll")
def poll(request: Request, response: Response, db: Db):
    require_origin(request)
    key = auth.digest(request.cookies.get(PUBLIC_COOKIE, ""))
    attempt = db.get(OAuthAttempt, key)
    if not attempt or attempt.expires <= time.time():
        raise HTTPException(410, "Sign-in expired. Start again.")
    flow = json.loads(auth.unseal(attempt.flow))
    if time.time() < flow["next_poll"]:
        return {"connected": False, "interval": flow["interval"]}
    # Commit throttle before contacting Microsoft. The opaque device code stays server-side.
    flow["next_poll"] = time.time() + flow["interval"]
    attempt.flow = auth.seal(json.dumps(flow))
    db.commit()
    status, payload = microsoft_post(flow["tenant"], "token", {"client_id": flow["client_id"], "grant_type": "urn:ietf:params:oauth:grant-type:device_code", "device_code": flow["device_code"]})
    if status != 200:
        error = payload.get("error")
        if error in {"authorization_pending", "slow_down"}:
            if error == "slow_down":
                flow["interval"] += 5
                flow["next_poll"] = time.time() + flow["interval"]
                db.execute(update(OAuthAttempt).where(OAuthAttempt.state_hash == key).values(flow=auth.seal(json.dumps(flow))))
                db.commit()
            return {"connected": False, "interval": flow["interval"]}
        db.execute(delete(OAuthAttempt).where(OAuthAttempt.state_hash == key)); db.commit()
        raise HTTPException(401, "Sign-in was declined or expired. Start again.")
    consumed = db.execute(delete(OAuthAttempt).where(OAuthAttempt.state_hash == key)).rowcount
    db.commit()
    if not consumed:
        raise HTTPException(409, "Sign-in already used or cancelled")
    return connect_tokens(payload, flow["tenant"], flow["client_id"], request, response, db)


class TemporaryToken(BaseModel):
    access_token: str = Field(min_length=16, max_length=32000)
    accepted: bool


@router.post("/personal/token")
def token(body: TemporaryToken, request: Request, response: Response, db: Db):
    require_origin(request)
    if not body.accepted:
        raise HTTPException(403, "Accept mailbox access first")
    return connect_tokens({"access_token": body.access_token.strip()}, "temporary", "", request, response, db)


def token_for_public(connection):
    stored = json.loads(auth.unseal(connection.token_cache))
    if stored["expires"] > time.time():
        return stored["access_token"], connection.token_cache
    if not stored.get("refresh_token"):
        raise ValueError("reauthorization_required")
    status, payload = microsoft_post(stored["tenant"], "token", {"client_id": stored["client_id"], "grant_type": "refresh_token", "refresh_token": stored["refresh_token"], "scope": SCOPES})
    if status != 200 or not payload.get("access_token"):
        raise ValueError("reauthorization_required")
    stored.update(access_token=payload["access_token"], refresh_token=payload.get("refresh_token") or stored["refresh_token"], expires=time.time() + max(0, int(payload.get("expires_in", 3600)) - 120))
    return stored["access_token"], auth.seal(json.dumps(stored))
