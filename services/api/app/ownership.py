"""Who may act on a student's records: only that student, as identified by `current_user()`.

Identity still comes only from `identity.current_user` (the demo `X-Waypoint-User` header, or `?as=`
on the event streams that cannot send headers). Replacing that function with real sign-in
upgrades every route here at once.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .database import get_db
from .identity import User, current_user, resolve_user
from .models import ChatMessage, ChatThread, Student


def require_own_message(db: Session, student_id: str, message_id: str) -> ChatMessage:
    """A message the student wrote in one of their own threads: what a fact or memory must cite."""
    message = db.get(ChatMessage, message_id)
    thread = db.get(ChatThread, message.thread_id) if message is not None else None
    if message is None or message.role != "user" or thread is None or thread.student_id != student_id:
        raise HTTPException(422, "source_message_id must be one of this student's own messages; use the source_message_id from THIS run's header")
    return message


def assert_owner(user: User, student_id: str) -> None:
    if user.role != "student" or user.student_id != student_id:
        raise HTTPException(403, "You can only open your own Waypoint records")


def owned_student(
    student_id: str,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(current_user)],
) -> Student:
    """Path dependency for /api/students/{student_id}/...: exists and belongs to the caller."""
    student = db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Student not found")
    assert_owner(user, student.id)
    return student


def stream_user(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    as_user: Annotated[str | None, Query(alias="as")] = None,
) -> User:
    """EventSource cannot send headers, so streams also accept `?as=` like the team stream."""
    header = request.headers.get("x-waypoint-user")
    user = resolve_user(db, header or as_user)
    if user is None or user.source != "demo":
        raise HTTPException(401, "Choose who you are with the View as switcher")
    return user


OwnedStudent = Annotated[Student, Depends(owned_student)]
StreamUser = Annotated[User, Depends(stream_user)]
