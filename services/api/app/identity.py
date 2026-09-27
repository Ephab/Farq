from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import DateTime, ForeignKey, String, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base, get_db
from .models import Student, now


class User(Base):
    """Someone who can act in Farq. Students reuse their student id as their
    user id, so existing `farq.current-student` ids work as `X-Farq-User`."""

    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120))
    # student | instructor
    role: Mapped[str] = mapped_column(String(16), default="student", index=True)
    student_id: Mapped[str | None] = mapped_column(ForeignKey("students.id"), nullable=True, unique=True)
    # demo | microsoft
    source: Mapped[str] = mapped_column(String(16), default="demo")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def resolve_user(db: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    user = db.get(User, user_id)
    if user is not None:
        return user
    student = db.get(Student, user_id)
    if student is None:
        return None
    user = User(id=student.id, display_name=student.display_name, role="student", student_id=student.id)
    db.add(user)
    db.commit()
    return user


def current_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    x_farq_user: Annotated[str | None, Header()] = None,
) -> User:
    """The single identity seam. Microsoft sign-in replaces only this function."""
    from .outlook.auth import session_user
    mailbox_path = request.url.path.startswith("/api/outlook/") or (request.url.path.startswith("/api/chat/threads/") and request.url.path.endswith("/messages") and request.method == "POST")
    signed_in = session_user(request, db) if mailbox_path else None
    if signed_in is not None:
        return signed_in
    user = resolve_user(db, x_farq_user)
    if user is None or user.source != "demo":
        raise HTTPException(401, "Choose who you are with the View as switcher")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
router = APIRouter()


def user_dict(user: User) -> dict:
    return {"id": user.id, "display_name": user.display_name, "role": user.role, "student_id": user.student_id}


@router.get("/api/me")
def me(user: CurrentUser) -> dict:
    return user_dict(user)


@router.get("/api/demo/users")
def demo_users(db: Annotated[Session, Depends(get_db)]) -> list[dict]:
    users = db.scalars(select(User).where(User.source == "demo").order_by(User.role.desc(), User.display_name)).all()
    return [user_dict(item) for item in users]
