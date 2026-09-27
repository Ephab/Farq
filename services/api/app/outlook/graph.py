"""Read-only temporary Graph tokens; no app registration, sign-in flow or refresh."""
import json
import secrets
import time

import httpx
from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from ..identity import User
from ..models import uid
from . import auth
from .models import MailConnection, MailSession
from .router import Db, router


def connect_tokens(payload, request, response, db):
    access = str(payload.get("access_token", ""))
    if len(access) < 16:
        raise HTTPException(401, "Microsoft did not return a usable access token")
    try:
        result = httpx.get("https://graph.microsoft.com/v1.0/me", params={"$select": "id,displayName,mail,userPrincipalName"}, headers={"Authorization": f"Bearer {access}"}, timeout=20, follow_redirects=False)
        result.raise_for_status()
        profile = result.json()
        if not isinstance(profile, dict) or not profile.get("id"):
            raise ValueError()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(401, "Microsoft rejected the token. User.Read and Mail.Read consent are required.") from None
    namespace = auth.TOKEN_TENANT
    connection = db.scalar(select(MailConnection).where(MailConnection.tenant == namespace, MailConnection.account_id == profile["id"]))
    if connection is None:
        user = User(id=uid(), display_name=str(profile.get("displayName") or "Outlook")[:120], source="microsoft")
        db.add(user)
        db.flush()
        connection = MailConnection(user_id=user.id, tenant=namespace, account_id=profile["id"], label="")
        db.add(connection)
        db.flush()
    connection.label = str(profile.get("mail") or profile.get("userPrincipalName") or "Outlook")[:200]
    connection.token_cache = auth.seal(json.dumps({"access_token": access, "expires": time.time() + max(0, int(payload.get("expires_in", 3000)) - 120)}))
    connection.connected, connection.status, connection.error = True, "paused", ""
    connection.auto_sync = False
    connection.generation += 1
    connection.next_sync, connection.lease_until, connection.lease_id = 0, 0, ""
    token = secrets.token_urlsafe(32)
    db.execute(delete(MailSession).where(MailSession.token_hash == auth.digest(request.cookies.get(auth.COOKIE, ""))))
    db.add(MailSession(token_hash=auth.digest(token), user_id=connection.user_id, expires=time.time() + 7 * 86400))
    db.commit()
    response.set_cookie(auth.COOKIE, token, max_age=7 * 86400, httponly=True, secure=auth.origin().startswith("https"), samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"connected": True}


class TemporaryToken(BaseModel):
    access_token: str = Field(min_length=16, max_length=32000)
    accepted: bool


@router.post("/token")
def token(body: TemporaryToken, request: Request, response: Response, db: Db):
    auth.require_origin(request)
    auth.encryption_key()
    if not body.accepted:
        raise HTTPException(403, "Accept mailbox access first")
    return connect_tokens({"access_token": body.access_token.strip()}, request, response, db)


