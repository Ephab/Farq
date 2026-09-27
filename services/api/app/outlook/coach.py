"""Read-only cached-mail tools, authorized by an expiring per-run capability."""
import secrets
import time

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select

from ..identity import current_user
from ..models import AgentRun
from . import auth, desktop
from .models import MailCoachGrant, MailConnection, MailItem, MailSession


def issue_grant(request: Request, db, run_id: str) -> str | None:
    # Mail identity comes from current_user, never a student ID supplied by the model.
    if not request.cookies.get(auth.COOKIE):
        return None
    try:
        user = current_user(request, db, None)
    except HTTPException as error:
        if error.status_code == 401:
            return None
        raise
    session = db.get(MailSession, auth.digest(request.cookies[auth.COOKIE]))
    if not session or not session.coach_access or session.user_id != user.id:
        return None
    auth.require_origin(request)
    connection = db.scalar(select(MailConnection).where(MailConnection.user_id == user.id))
    if not connection or not connection.connected or connection.tenant not in {auth.TOKEN_TENANT, desktop.TENANT}:
        return None
    db.execute(delete(MailCoachGrant).where(MailCoachGrant.expires <= time.time()))
    token = secrets.token_urlsafe(32)
    db.add(MailCoachGrant(token_hash=auth.digest(token), session_hash=session.token_hash,
                         run_id=run_id, connection_id=connection.id, generation=connection.generation,
                         expires=min(session.expires, time.time() + 600)))
    return token


class MailSearch(BaseModel):
    mailbox_access: str = Field(min_length=32, max_length=128)
    query: str = Field(default="", max_length=200)
    offset: int = Field(default=0, ge=0, le=100_000)
    limit: int = Field(default=10, ge=1, le=20)


class MailRead(BaseModel):
    mailbox_access: str = Field(min_length=32, max_length=128)
    item_id: str = Field(max_length=128)
    cursor: int = Field(default=0, ge=0, le=10_000_000)


def authorized_connection(token, db):
    grant = db.get(MailCoachGrant, auth.digest(token))
    if grant is None or grant.expires <= time.time():
        raise HTTPException(403, "Mailbox capability expired or unavailable")
    session = db.get(MailSession, grant.session_hash)
    run = db.get(AgentRun, grant.run_id)
    connection = db.get(MailConnection, grant.connection_id)
    if (not session or session.expires <= time.time() or not session.coach_access
            or not run or run.status != "running" or not connection or not connection.connected
            or connection.generation != grant.generation or connection.user_id != session.user_id
            or connection.tenant not in {auth.TOKEN_TENANT, desktop.TENANT}
            or (connection.tenant == desktop.TENANT and not desktop.enabled())):
        raise HTTPException(403, "Mailbox access revoked or run no longer active")
    return connection


def visible_mail(connection):
    return [MailItem.connection_id == connection.id, MailItem.expires > time.time(), MailItem.removed.is_(False)]


def search_mail(body: MailSearch, db):
    connection = authorized_connection(body.mailbox_access, db)
    where = visible_mail(connection)
    if body.query.strip():
        where.append(or_(*(column.icontains(body.query.strip(), autoescape=True)
                           for column in (MailItem.subject, MailItem.sender, MailItem.excerpt))))
    items = db.scalars(select(MailItem).where(*where).order_by(MailItem.received.desc(), MailItem.id)
                       .offset(body.offset).limit(body.limit + 1)).all()
    return {"untrusted_email_data": True, "source": "Farq synced cache (not a live mailbox search)",
            "items": [{"id": item.id, "subject": item.subject[:300], "sender": item.sender[:300],
                       "received": item.received, "snippet": item.excerpt[:400]} for item in items[:body.limit]],
            "next_offset": body.offset + body.limit if len(items) > body.limit else None}


def read_mail(body: MailRead, db):
    connection = authorized_connection(body.mailbox_access, db)
    item = db.scalar(select(MailItem).where(*visible_mail(connection), MailItem.id == body.item_id))
    if item is None:
        raise HTTPException(404, "Email not found")
    end = body.cursor + 8000
    return {"untrusted_email_data": True, "id": item.id, "subject": item.subject[:300],
            "sender": item.sender[:300], "received": item.received, "body": item.excerpt[body.cursor:end],
            "next_cursor": end if end < len(item.excerpt) else None, "total_characters": len(item.excerpt)}
