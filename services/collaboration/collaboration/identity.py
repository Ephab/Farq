from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .models import Account


@dataclass(frozen=True)
class Identity:
    issuer: str
    subject: str
    display_name: str
    expires_at: int = 0


bearer = HTTPBearer(auto_error=False)


def current_user(request: Request,
                 credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> Account:
    if credentials is None:
        raise HTTPException(401, "Missing access token", headers={"WWW-Authenticate": "Bearer"})
    try:
        identity = request.app.state.verifier.verify(credentials.credentials)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid access token", headers={"WWW-Authenticate": "Bearer"}) from None
    with request.app.state.sessions() as db:
        request.state.auth_expires = identity.expires_at
        query = select(Account).where(Account.issuer == identity.issuer, Account.subject == identity.subject)
        account = db.scalar(query)
        if account is None:
            account = Account(issuer=identity.issuer, subject=identity.subject, display_name=identity.display_name)
            db.add(account)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                account = db.scalar(query)
                if account is None:
                    raise
        if account.disabled:
            raise HTTPException(403, "Account disabled")
        return account


CurrentUser = Annotated[Account, Depends(current_user)]

# Domain compatibility alias, never a demo identity resolver.
User = Account


def user_dict(user: Account):
    return {"id": user.id, "display_name": user.display_name, "role": "student", "student_id": None}
