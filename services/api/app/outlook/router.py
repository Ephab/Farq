from __future__ import annotations

import json
import secrets
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, or_, and_, update
from sqlalchemy.orm import Session

from .. import decision_engines
from ..database import get_db
from ..identity import CurrentUser, User
from ..models import uid
from . import auth, desktop
from .models import MailConnection, MailFolder, MailItem, MailSession, MailboxConsent, MailCoachGrant

router = APIRouter(prefix="/api/outlook", tags=["Outlook"])
Db = Annotated[Session, Depends(get_db)]


def connection_for(user: User, db: Session) -> MailConnection:
    if user.source not in {"microsoft", "outlook-desktop"}:
        raise HTTPException(401, "Connect your university Outlook account first")
    connection = db.scalar(select(MailConnection).where(MailConnection.user_id == user.id))
    if connection is None or not connection.connected or connection.tenant not in {desktop.TENANT, auth.TOKEN_TENANT}:
        raise HTTPException(401, "Connect your university Outlook account first")
    return connection


@router.get("/status")
def status(request: Request, response: Response, db: Db):
    response.headers["Cache-Control"] = "no-store"
    desktop_available = desktop.enabled()
    if desktop_available:
        try:
            desktop.require_local(request)
        except HTTPException:
            desktop_available = False
    try:
        auth.encryption_key()
        token_available = True
    except HTTPException:
        token_available = False
    options = {"configured": desktop_available or token_available, "desktop_available": desktop_available,
               "token_available": token_available, "provider": "desktop" if desktop_available else "token"}
    user = auth.session_user(request, db)
    connection = db.scalar(select(MailConnection).where(MailConnection.user_id == user.id)) if user else None
    if not connection or not connection.connected or connection.tenant not in {desktop.TENANT, auth.TOKEN_TENANT}:
        return {**options, "connected": False}
    return {**options, "connected": True, "account": connection.label,
            "provider": "desktop" if connection.tenant == desktop.TENANT else "token",
            "worker_enabled": os.getenv("OUTLOOK_SYNC_ENABLED", "false").lower() == "true",
            "coach_access": db.get(MailSession, auth.digest(request.cookies[auth.COOKIE])).coach_access,
            "classifier": connection.classifier, "classifiers": decision_engines.engines_status(),
            "classify_limit": connection.classify_limit,
            "pending": db.scalar(select(func.count()).select_from(MailItem).where(MailItem.connection_id == connection.id, MailItem.pending.is_(True), MailItem.removed.is_(False))),
            "auto_sync": connection.auto_sync, "status": connection.status,
            "last_sync": connection.last_sync, "processed": connection.processed, "error": connection.error}


class DesktopConsent(BaseModel):
    accepted: bool


@router.post("/desktop/consent")
def desktop_consent(request: Request, response: Response, db: Db):
    auth.require_origin(request)
    desktop.require_local(request)
    if not desktop.enabled():
        raise HTTPException(503, "Install classic Outlook and rerun setup.bat on this Windows computer.")
    nonce = secrets.token_urlsafe(32)
    previous = request.cookies.get(auth.CONSENT_COOKIE, "")
    db.execute(delete(MailboxConsent).where(MailboxConsent.token_hash == desktop.consent_digest(previous)))
    db.execute(delete(MailboxConsent).where(MailboxConsent.expires < time.time()))
    db.add(MailboxConsent(token_hash=desktop.consent_digest(nonce), expires=time.time() + 120))
    db.commit()
    response.set_cookie(auth.CONSENT_COOKIE, nonce, max_age=120, httponly=True, samesite="strict", path="/api/outlook")
    response.headers["Cache-Control"] = "no-store"
    return {"ready": True}


@router.post("/desktop/connect")
def connect_desktop(body: DesktopConsent, request: Request, response: Response, db: Db):
    auth.require_origin(request)
    desktop.require_local(request)
    if not desktop.enabled():
        raise HTTPException(503, "Install classic Outlook and rerun setup.bat on this Windows computer.")
    if not body.accepted:
        raise HTTPException(403, "Accept local mailbox access first.")
    token_hash = desktop.consent_digest(request.cookies.get(auth.CONSENT_COOKIE, ""))
    consumed = db.execute(delete(MailboxConsent).where(MailboxConsent.token_hash == token_hash, MailboxConsent.expires > time.time())).rowcount
    db.commit()
    if not consumed:
        raise HTTPException(403, "Consent expired. Check the consent box again.")
    response.delete_cookie(auth.CONSENT_COOKIE, path="/api/outlook")
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


class CoachAccess(BaseModel):
    accepted: bool


@router.patch("/coach-access")
def coach_access(body: CoachAccess, request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    connection_for(user, db)
    session = db.get(MailSession, auth.digest(request.cookies.get(auth.COOKIE, "")))
    if not session or session.expires <= time.time():
        raise HTTPException(401, "Reconnect Outlook")
    session.coach_access = body.accepted
    # Revocation stays effective even if permission is later enabled again.
    db.execute(delete(MailCoachGrant).where(MailCoachGrant.session_hash == session.token_hash))
    db.commit()
    return {"coach_access": session.coach_access}


class Classifier(BaseModel):
    engine: Literal["laya", "span", "jev"]


@router.patch("/classifier")
def classifier(body: Classifier, request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    connection = connection_for(user, db)
    # Laya is always selectable: choosing it withdraws cloud consent even when Laya isn't installed yet.
    if body.engine != "laya" and not decision_engines.INFO[body.engine]().available:
        raise HTTPException(409, "That classifier isn't set up on this server.")
    connection.classifier = body.engine
    db.commit()
    return {"classifier": connection.classifier}


CLASSIFY_LIMITS = {25, 50, 100, 250, 500, 1000}


class ClassifyLimit(BaseModel):
    limit: int | None  # None = no cutoff


@router.patch("/classify-limit")
def classify_limit(body: ClassifyLimit, request: Request, user: CurrentUser, db: Db):
    auth.require_origin(request)
    if body.limit is not None and body.limit not in CLASSIFY_LIMITS:
        raise HTTPException(422, "Choose one of the offered cutoffs.")
    connection = connection_for(user, db)
    raised = body.limit is None or (connection.classify_limit is not None and body.limit > connection.classify_limit)
    connection.classify_limit = body.limit
    if raised:
        # Mail skipped by the old cutoff gets another chance; already-labelled mail keeps its labels.
        db.execute(update(MailItem).where(MailItem.connection_id == connection.id, MailItem.removed.is_(False),
                                          MailItem.classification.contains('"beyond_cutoff"')).values(pending=True))
        if connection.auto_sync and connection.status not in {"running", "reconnect"}:
            connection.status, connection.next_sync = "queued", 0
    db.commit()
    return {"classify_limit": connection.classify_limit}


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
    connection.classifier = "laya"
    connection.classify_limit = None
    db.execute(delete(MailItem).where(MailItem.connection_id == connection.id))
    db.execute(delete(MailFolder).where(MailFolder.connection_id == connection.id))
    db.execute(delete(MailCoachGrant).where(MailCoachGrant.connection_id == connection.id))
    db.execute(delete(MailSession).where(MailSession.user_id == user.id))
    consent = request.cookies.get(auth.CONSENT_COOKIE, "")
    if consent and desktop.enabled():
        db.execute(delete(MailboxConsent).where(MailboxConsent.token_hash == desktop.consent_digest(consent)))
    db.commit()
    response.delete_cookie(auth.COOKIE, path="/")
    response.delete_cookie(auth.CONSENT_COOKIE, path="/api/outlook")
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
        # Mail skipped by the cutoff is old by definition; keep it out of the review queue.
        where.append(MailItem.reviewed.is_(False))
        where.append(~MailItem.classification.contains('"beyond_cutoff"'))
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


# Register temporary Graph-token access against the shared private cache.
from . import graph  # noqa: E402,F401
