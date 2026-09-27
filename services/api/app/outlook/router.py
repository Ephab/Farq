from __future__ import annotations

import html
import json
import secrets
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

import httpx
import msal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, or_, and_
from sqlalchemy.orm import Session

from ..database import get_db
from ..identity import CurrentUser, User
from ..models import uid
from . import auth, desktop
from .models import MailConnection, MailFolder, MailItem, MailSession, OAuthAttempt

router = APIRouter(prefix="/api/outlook", tags=["Outlook"])
Db = Annotated[Session, Depends(get_db)]


def connection_for(user: User, db: Session) -> MailConnection:
    if user.source not in {"microsoft", "outlook-desktop"}:
        raise HTTPException(401, "Connect your university Outlook account first")
    connection = db.scalar(select(MailConnection).where(MailConnection.user_id == user.id))
    if connection is None or not connection.connected:
        raise HTTPException(401, "Connect your university Outlook account first")
    return connection


@router.get("/status")
def status(request: Request, response: Response, db: Db):
    response.headers["Cache-Control"] = "no-store"
    user = auth.session_user(request, db)
    connection = db.scalar(select(MailConnection).where(MailConnection.user_id == user.id)) if user else None
    if not connection or not connection.connected:
        try:
            desktop.require_local(request) if desktop.enabled() else auth.settings()
        except HTTPException as error:
            return {"configured": False, "connected": False, "provider": "desktop" if desktop.enabled() else "graph", "error": error.detail}
        return {"configured": True, "connected": False, "provider": "desktop" if desktop.enabled() else "graph"}
    return {"configured": True, "connected": True, "account": connection.label,
            "provider": "desktop" if connection.tenant == desktop.TENANT else "personal" if connection.tenant.startswith("public:") else "graph",
            "worker_enabled": os.getenv("OUTLOOK_SYNC_ENABLED", "false").lower() == "true",
            "auto_sync": connection.auto_sync, "status": connection.status,
            "last_sync": connection.last_sync, "processed": connection.processed, "error": connection.error}


class DesktopConsent(BaseModel):
    pairing_code: str = Field(min_length=1, max_length=128)
    accepted: bool


@router.post("/desktop/connect")
def connect_desktop(body: DesktopConsent, request: Request, response: Response, db: Db):
    if not desktop.enabled():
        raise HTTPException(404, "Desktop Outlook is not enabled")
    auth.require_origin(request)
    if not body.accepted or not secrets.compare_digest(body.pairing_code.strip(), desktop.pairing_key()):
        raise HTTPException(403, "Accept local mailbox access and enter the pairing code from this computer.")
    try:
        store_id, label = desktop.profile()
    except Exception:
        raise HTTPException(503, "Open classic Outlook with your university profile. Local access may require Outlook approval or be blocked by your organization.") from None
    connection = db.scalar(select(MailConnection).where(MailConnection.tenant == desktop.TENANT, MailConnection.account_id == store_id))
    if connection is None:
        user = User(id=uid(), display_name="Local Outlook", source="outlook-desktop")
        db.add(user)
        db.flush()
        connection = MailConnection(user_id=user.id, tenant=desktop.TENANT, account_id=store_id, label=label)
        db.add(connection)
        db.flush()
    connection.connected, connection.status, connection.error = True, "queued", ""
    connection.label = label
    connection.generation += 1
    connection.next_sync, connection.lease_until, connection.lease_id = 0, 0, ""
    session_token = secrets.token_urlsafe(32)
    db.execute(delete(MailSession).where(MailSession.user_id == connection.user_id))
    db.add(MailSession(token_hash=auth.digest(session_token), user_id=connection.user_id, expires=time.time() + 7 * 86400))
    db.commit()
    response.set_cookie(auth.COOKIE, session_token, max_age=7 * 86400, httponly=True, samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"connected": True}


@router.post("/authorize")
def authorize(request: Request, response: Response, db: Db):
    auth.require_origin(request)
    if desktop.enabled():
        raise HTTPException(409, "Use the local Outlook connection")
    config = auth.settings()
    browser = secrets.token_urlsafe(32)
    flow = auth.client().initiate_auth_code_flow(auth.SCOPES, redirect_uri=config.redirect, prompt="select_account")
    if not flow.get("auth_uri") or not flow.get("state"):
        raise HTTPException(502, "Microsoft sign-in is unavailable")
    db.execute(delete(OAuthAttempt).where(OAuthAttempt.expires < time.time()))
    db.add(OAuthAttempt(state_hash=auth.digest(flow["state"]), browser_hash=auth.digest(browser),
                        flow=auth.seal(json.dumps(flow)), expires=time.time() + 600))
    db.commit()
    response.set_cookie(auth.FLOW_COOKIE, browser, max_age=600, httponly=True, secure=config.secure, samesite="lax", path="/api/outlook")
    response.headers["Cache-Control"] = "no-store"
    return {"url": flow["auth_uri"]}


def completion(success: bool) -> HTMLResponse:
    config, nonce = auth.settings(), secrets.token_urlsafe(24)
    state = "connected" if success else "failed"
    origin = json.dumps(config.origin.rstrip("/")).replace("<", "\\u003c")
    text = "Outlook connected. You can close this window." if success else "Sign-in was cancelled or failed. Return to Farq and try again. University administrator approval may be required."
    response = HTMLResponse(f'''<!doctype html><html><head><meta charset="utf-8"><title>Farq Outlook</title></head>
<body><p>{text}</p><a href="{html.escape(config.origin, quote=True)}">Return to Farq</a>
<script nonce="{nonce}">if(window.opener){{window.opener.postMessage({{type:"farq-outlook",status:"{state}"}},{origin});window.close();}}</script></body></html>''')
    response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                             "Content-Security-Policy": f"default-src 'none'; script-src 'nonce-{nonce}'; base-uri 'none'; frame-ancestors 'none'"})
    response.delete_cookie(auth.FLOW_COOKIE, path="/api/outlook")
    return response


@router.get("/callback")
def callback(request: Request, db: Db):
    state = auth.digest(request.query_params.get("state", ""))
    attempt = db.get(OAuthAttempt, state)
    browser = auth.digest(request.cookies.get(auth.FLOW_COOKIE, ""))
    if not attempt or attempt.expires < time.time() or not secrets.compare_digest(attempt.browser_hash, browser):
        raise HTTPException(400, "Invalid or expired sign-in. Start again from Farq.")
    flow = json.loads(auth.unseal(attempt.flow))
    consumed = db.execute(delete(OAuthAttempt).where(OAuthAttempt.state_hash == state)).rowcount
    db.commit()  # Consume before external calls; replay is never accepted.
    if not consumed:
        raise HTTPException(400, "Sign-in already used")
    config = auth.settings()
    try:
        cache = msal.SerializableTokenCache()
        result = auth.client(cache).acquire_token_by_auth_code_flow(flow, dict(request.query_params))
        claims = result.get("id_token_claims", {})
        if "access_token" not in result or claims.get("tid", "").lower() != config.tenant.lower() or not claims.get("oid"):
            return completion(False)
        with httpx.Client(timeout=20, follow_redirects=False) as graph:
            me = graph.get("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName", headers={"Authorization": f"Bearer {result['access_token']}"})
            me.raise_for_status()
            profile = me.json()
        if profile.get("id", "").lower() != claims["oid"].lower():
            return completion(False)
        connection = db.scalar(select(MailConnection).where(MailConnection.tenant == config.tenant.lower(), MailConnection.account_id == profile["id"]))
        if connection is None:
            # No browser-supplied student ID may claim a mailbox. This identity owns
            # private mail only; legacy demo profiles are deliberately not migrated.
            user = User(id=uid(), display_name=str(profile.get("displayName") or "Student")[:120], source="microsoft", role="student")
            db.add(user)
            db.flush()
            connection = MailConnection(user_id=user.id, tenant=config.tenant.lower(), account_id=profile["id"], label="")
            db.add(connection)
            db.flush()
        connection.label = str(profile.get("mail") or profile.get("userPrincipalName") or "University Outlook")[:200]
        connection.token_cache = auth.seal(cache.serialize())
        connection.connected, connection.status, connection.error = True, "queued", ""
        connection.generation += 1
        connection.next_sync, connection.lease_until, connection.lease_id = 0, 0, ""
        session_token = secrets.token_urlsafe(32)
        old = request.cookies.get(auth.COOKIE)
        if old:
            db.execute(delete(MailSession).where(MailSession.token_hash == auth.digest(old)))
        db.execute(delete(MailSession).where(MailSession.expires < time.time()))
        db.add(MailSession(token_hash=auth.digest(session_token), user_id=connection.user_id, expires=time.time() + 7 * 86400))
        db.commit()
    except Exception:
        db.rollback()
        return completion(False)
    response = completion(True)
    response.set_cookie(auth.COOKIE, session_token, max_age=7 * 86400, httponly=True, secure=config.secure, samesite="lax", path="/")
    return response


@router.post("/sync")
def sync(request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    if os.getenv("OUTLOOK_SYNC_ENABLED", "false").lower() != "true":
        raise HTTPException(503, "Enable OUTLOOK_SYNC_ENABLED on the API server and restart it to sync mail.")
    connection = connection_for(user, db)
    if connection.status != "running" or connection.lease_until < time.time():
        connection.status = "queued"
        connection.error = ""
        connection.next_sync = 0
    db.commit()
    return {"status": connection.status}


class Preferences(BaseModel):
    auto_sync: bool


@router.patch("/preferences")
def preferences(body: Preferences, request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    connection = connection_for(user, db)
    connection.auto_sync = body.auto_sync
    if not body.auto_sync:
        connection.generation += 1
        connection.lease_id, connection.lease_until, connection.status = "", 0, "paused"
    else:
        connection.next_sync, connection.status = 0, "queued"
    db.commit()
    return {"auto_sync": connection.auto_sync}


@router.delete("/connection")
def disconnect(request: Request, response: Response, user: CurrentUser, db: Db):
    auth.require_origin(request)
    connection = connection_for(user, db)
    connection.connected = False
    connection.generation += 1
    connection.token_cache, connection.lease_id, connection.status = "", "", "disconnected"
    connection.folder_scan_url, connection.folders_json = "", "[]"
    connection.label = ""
    db.execute(delete(MailItem).where(MailItem.connection_id == connection.id))
    db.execute(delete(MailFolder).where(MailFolder.connection_id == connection.id))
    db.execute(delete(MailSession).where(MailSession.user_id == user.id))
    # Browser-bound pending sign-ins must not reconnect after disconnect.
    flow_cookie = request.cookies.get(auth.FLOW_COOKIE, "")
    db.execute(delete(OAuthAttempt).where(OAuthAttempt.browser_hash == auth.digest(flow_cookie)))
    from .personal import PUBLIC_COOKIE
    db.execute(delete(OAuthAttempt).where(OAuthAttempt.state_hash == auth.digest(request.cookies.get(PUBLIC_COOKIE, ""))))
    db.commit()
    response.delete_cookie(PUBLIC_COOKIE, path="/api/outlook")
    response.delete_cookie(auth.COOKIE, path="/")
    response.delete_cookie(auth.FLOW_COOKIE, path="/api/outlook")
    return {"connected": False}


def item_dict(item, preview=False):
    return {"id": item.id, "subject": item.subject, "sender": item.sender, "excerpt": item.excerpt[:240] if preview else item.excerpt,
            "received": item.received, "web_url": item.web_url, "classification": json.loads(item.classification),
            "pinned": item.pinned, "dismissed": item.dismissed, "reviewed": item.reviewed, "due_date": item.due_date}


@router.get("/messages")
def messages(response: Response, user: CurrentUser, db: Db, offset: int = 0, limit: int = 50, view: str = "all", day: date | None = None, timezone_offset: int = 0, q: str = "", category: str = "", sort: str = "newest", preview: bool = False):
    connection = connection_for(user, db)
    if not 0 <= offset <= 1_000_000 or not 1 <= limit <= 100 or not -840 <= timezone_offset <= 840:
        raise HTTPException(422, "Invalid page")
    where = [MailItem.connection_id == connection.id, MailItem.expires > time.time(), MailItem.removed.is_(False)]
    if view not in {"all", "important", "today", "review", "dismissed", "followup"}:
        raise HTTPException(422, "Unknown view")
    if len(q) > 200 or category not in {"", "coursework", "administration", "opportunity", "other", "unclassified"} or sort not in {"newest", "oldest", "due"}:
        raise HTTPException(422, "Invalid mail filter")
    if q.strip():
        where.append(or_(*(column.icontains(q.strip(), autoescape=True) for column in (MailItem.subject, MailItem.sender, MailItem.excerpt))))
    if category:
        value = func.json_extract(MailItem.classification, "$.category")
        where.append(value.is_(None) if category == "unclassified" else value == category)
    where.append(MailItem.dismissed.is_(view == "dismissed"))
    if view == "important":
        where.append(or_(MailItem.pinned.is_(True), func.json_extract(MailItem.classification, "$.important_probability") >= 0.6))
    elif view == "review":
        where.append(MailItem.reviewed.is_(False))
    elif view == "followup":
        where.append(MailItem.due_date.is_not(None))
    elif view == "today":
        today = (day or date.today()).isoformat()
        start = datetime.combine(date.fromisoformat(today), datetime.min.time(), tzinfo=timezone.utc) + timedelta(minutes=timezone_offset)
        end = start + timedelta(days=1)
        where.append(or_(MailItem.due_date <= today, and_(MailItem.received >= start.strftime("%Y-%m-%dT%H:%M:%SZ"), MailItem.received < end.strftime("%Y-%m-%dT%H:%M:%SZ"))))
    ordering = [MailItem.received.asc()] if sort == "oldest" else [MailItem.due_date.is_(None), MailItem.due_date.asc()] if sort == "due" else [MailItem.received.desc()]
    rows = db.scalars(select(MailItem).where(*where).order_by(*ordering, MailItem.id).offset(offset).limit(limit)).all()
    response.headers["Cache-Control"] = "no-store"
    return {"items": [item_dict(row, preview) for row in rows], "total": db.scalar(select(func.count()).select_from(MailItem).where(*where))}


@router.get("/messages/{item_id}")
def message_detail(item_id: str, response: Response, user: CurrentUser, db: Db):
    connection = connection_for(user, db)
    item = db.scalar(select(MailItem).where(MailItem.id == item_id, MailItem.connection_id == connection.id, MailItem.expires > time.time(), MailItem.removed.is_(False)))
    if item is None:
        raise HTTPException(404, "Message not found")
    response.headers["Cache-Control"] = "no-store"
    return item_dict(item)


class ItemDecision(BaseModel):
    pinned: bool | None = None
    dismissed: bool | None = None
    reviewed: bool | None = None
    due_date: date | None = None


class BulkDecision(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)
    changes: ItemDecision


@router.post("/messages/bulk")
def bulk_decide(body: BulkDecision, request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    connection = connection_for(user, db)
    ids = set(body.ids)
    items = db.scalars(select(MailItem).where(MailItem.id.in_(ids), MailItem.connection_id == connection.id, MailItem.expires > time.time(), MailItem.removed.is_(False))).all()
    if len(items) != len(ids):
        raise HTTPException(404, "Some messages are no longer available")
    for item in items:
        apply_decision(item, body.changes)
    db.commit()
    return {"updated": len(items)}


def apply_decision(item, body):
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "due_date":
            item.due_date = value.isoformat() if value else None
        elif value is not None:
            setattr(item, key, value)


@router.patch("/messages/{item_id}")
def decide(item_id: str, body: ItemDecision, request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    connection = connection_for(user, db)
    item = db.scalar(select(MailItem).where(MailItem.id == item_id, MailItem.connection_id == connection.id))
    if item is None:
        raise HTTPException(404, "Message not found")
    apply_decision(item, body)
    db.commit()
    return item_dict(item)


class EmailQuestion(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=25)
    question: str = Field(min_length=1, max_length=2000)
    accepted: bool
    provider: str | None = None
    model: str | None = None


@router.post("/chat")
def email_chat(body: EmailQuestion, request: Request, response: Response, user: CurrentUser, db: Db):
    from .chat import run_email_chat, EmailChatError
    auth.require_origin(request)
    connection = connection_for(user, db)
    if not body.accepted:
        raise HTTPException(403, "Accept sending these messages to the configured AI provider first")
    ids = list(dict.fromkeys(body.ids))
    items = db.scalars(select(MailItem).where(MailItem.id.in_(ids), MailItem.connection_id == connection.id,
                                            MailItem.removed.is_(False), MailItem.expires > time.time())).all()
    if len(items) != len(ids):
        raise HTTPException(404, "One or more selected emails are unavailable")
    by_id = {item.id: item for item in items}
    emails = [{"subject": by_id[key].subject, "sender": {"name": by_id[key].sender, "address": ""},
               "received": by_id[key].received, "body": by_id[key].excerpt, "preview": ""} for key in ids]
    response.headers["Cache-Control"] = "no-store"
    try:
        result = run_email_chat(emails, body.question, body.provider, body.model, request.headers.get("x-hermes-api-key"))
    except EmailChatError as error:
        raise HTTPException(error.status, str(error)) from None
    return {**result, "email_count": len(items)}


# Register main's alternate sign-in against the same private session/cache routes.
from . import personal  # noqa: E402,F401
