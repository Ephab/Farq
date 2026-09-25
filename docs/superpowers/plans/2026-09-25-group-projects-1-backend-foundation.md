# Group Projects: Plan 1, Backend Foundation, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the FastAPI/SQLite foundation for course group projects: demo identity, courses and assignments, teams and invites, the event log with the SSE stream, tasks and milestones, team chat, documents with section locks, presence, the workspace state snapshot, and the Team Falcon demo seed.

**Architecture:** A new `services/api/app/teams/` package holds one module per responsibility (policy, events, teams, chat, tasks, docs, presence, state, seed). They share a small `common.py`. Every team write calls `emit()` to add a `team_events` row in the same transaction (transactional outbox). One SSE endpoint polls that table and filters it by the viewer's role, so instructors never receive chat. Identity is a single dependency, `current_user()`, in `app/identity.py` that reads the `X-Farq-User` header. It is the only piece that Microsoft sign-in will replace.

**Tech Stack:** Python 3, FastAPI, SQLAlchemy 2 (typed `Mapped`), SQLite, Pydantic v2, pytest + `fastapi.testclient`.

**Spec:** `docs/superpowers/specs/2026-09-25-group-projects-design.md`

### Where this plan sits

The spec is split into four plans. Each produces working, testable software:

1. **This plan:** the backend foundation (spec §3–§7, §11, §12 and the non-Hermes parts of §13).
2. **Plan 2, proposals and Hermes as a teammate** (spec §8–§9): `team_proposals`, voting, lazy expiry, `team_agent_runs`, the `/internal/hermes/teams/*` endpoints, the six plugin tools, the `farq-team-coach` skill, slash commands, document drafting with the `section.drafting` replay, notices, and catch-up. Seeded students also get small roadmaps so teammate cards have stages.
3. **Plan 3, frontend core** (spec §10 except the signature moments): the View-as switcher, `useTeamStream`, TeamsHome with living covers and the briefing strip, the Studio workspace, the board, the chat, DocStudio and the instructor panel.
4. **Plan 4, signature moments and demo** (spec §10 moments 1–7, the Playwright demo script, and the doc updates in §14).

Plans 2–4 are written after this plan lands, so they can build on the real code.

## Global Constraints

- SQLite is authoritative. **Add tables only.** Do not alter existing tables (no `ADDED_COLUMNS` entries are needed).
- Hermes only proposes. Nothing in this plan lets Hermes write. Team activity **must not** create `StudentFact` rows. The seed's own facts use `source_kind="onboarding"`, because they stand in for onboarding answers.
- Instructors of a course may view every team except its chat. Chat means messages, reactions, typing, and any event or message with `visible_to_user_id` set.
- Every successful team write emits its event(s) in the same transaction, and a rejected write emits none. Personal or ephemeral state (seen pointer, lock heartbeat, presence, typing) emits no event.
- Identity comes only from `current_user()` (header `X-Farq-User`). The SSE stream alone uses the `?as=<user_id>` query parameter, because `EventSource` cannot send headers.
- Students' `User.id` equals their `Student.id`.
- Section lock length is 90 s. Poll interval is 0.4 s. Presence TTL is 30 s and typing TTL is 5 s.
- Datetimes read back from SQLite are naive. Always compare through `aware()`.
- Tests: `.venv/Scripts/python -m pytest services/api/tests`. The baseline is **92 passed**, and every task must keep all prior tests green.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Naive datetimes from SQLite in lock expiry.** A lock written as aware UTC comes back naive. An expired lock must be takeable, and a live lock must not be. *(Task 7: `test_expired_lock_can_be_taken_over`)*
2. **A student ending up on two teams for one assignment** by accepting an invite after forming their own team. This must be refused. *(Task 4: `test_accepting_is_refused_when_already_on_another_team`)*
3. **An instructor of a different course, or a classmate who isn't on the team,** reading a team. Both must get 403. *(Task 2: `test_instructor_of_another_course_is_an_outsider` and the `classmate` row of the permission table)*
4. **Reconnecting the stream while other members' private notices sit between events.** It must resume exactly after `Last-Event-ID` and never leak another member's private events. *(Task 3: `test_member_sees_team_and_own_private_events`, `test_stream_resumes_after_last_event_id`)*
5. **Arabic and emoji message text.** It must round-trip unchanged through REST and the event payload. *(Task 5: `test_posting_keeps_arabic_text_and_emits_one_event`)*

---

## File Structure

| File | Responsibility |
|---|---|
| `services/api/app/identity.py` | `User` table, `resolve_user`, `current_user` dependency, `/api/me`, `/api/demo/users` |
| `services/api/app/teams/__init__.py` | Imports the models; aggregates the team routers into `router` |
| `services/api/app/teams/models.py` | Course, enrollment, assignment, team, member, invite, milestone, task, decision, message, reaction, document, section and event tables |
| `services/api/app/teams/common.py` | `Db`, `aware`, `iso`, `loads`, `require`, `require_team` |
| `services/api/app/teams/policy.py` | `team_role`, `authorize`, `is_member` |
| `services/api/app/teams/events.py` | `emit`, `events_after`, `event_dict`, `sse_frame`, SSE endpoint |
| `services/api/app/teams/teams.py` | Home, team creation, invites, team detail, shared serializers |
| `services/api/app/teams/chat.py` | Messages, polls, reactions, decisions, seen pointer, `post_message` |
| `services/api/app/teams/tasks.py` | Tasks, dependencies (DAG), moves, milestones and milestone completion |
| `services/api/app/teams/docs.py` | Documents, IEEE outlines, section owners, locks, versioned saves |
| `services/api/app/teams/presence.py` | In-memory presence and typing, `presence_frame` |
| `services/api/app/teams/state.py` | Workspace snapshot and contribution summary |
| `services/api/app/teams/seed.py` | Idempotent demo seed (Team Falcon) |
| `services/api/app/main.py` | Include the routers; call `seed_teams` at startup |
| `services/api/tests/team_world.py` | Shared test fixture and world builders |
| `services/api/tests/test_teams_*.py` | One test module per task |

---

### Task 1: Identity seam

**Files:**
- Create: `services/api/app/identity.py`
- Create: `services/api/tests/team_world.py`
- Create: `services/api/tests/test_teams_identity.py`
- Modify: `services/api/app/main.py` (imports near line 30; `app.include_router` near line 51)

**Interfaces:**
- Produces: `User` (table `users`: `id, display_name, role, student_id, source, created_at`), `resolve_user(db, user_id) -> User | None`, `current_user(...) -> User`, `CurrentUser = Annotated[User, Depends(current_user)]`, `user_dict(user) -> dict`, `router`.
- Produces for tests: `team_world.client` (module fixture), `team_world.hdr(user_id) -> dict`.

- [ ] **Step 1: Write the shared test module and the failing tests**

`services/api/tests/team_world.py`:

```python
"""Shared fixtures for the Group Projects tests.

Import `client` into a test module to use the fixture:
    from team_world import client, hdr  # noqa: F401
"""
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"farq-teams-{uuid.uuid4()}.db"
# Same as the other test modules: never let an inherited DATABASE_URL point tests at real data.
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()


def hdr(user_id: str) -> dict:
    return {"X-Farq-User": user_id}
```

`services/api/tests/test_teams_identity.py`:

```python
from team_world import client, hdr  # noqa: F401

from app.database import SessionLocal
from app.identity import User


def test_student_header_becomes_a_user(client):
    response = client.get("/api/me", headers=hdr("demo-student"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == "demo-student"
    assert body["role"] == "student"
    assert body["student_id"] == "demo-student"


def test_missing_or_unknown_user_is_rejected(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers=hdr("nobody-here")).status_code == 401


def test_instructor_user_is_resolved_and_listed(client):
    db = SessionLocal()
    try:
        if db.get(User, "inst-identity") is None:
            db.add(User(id="inst-identity", display_name="Dr. Identity", role="instructor"))
            db.commit()
    finally:
        db.close()
    body = client.get("/api/me", headers=hdr("inst-identity")).json()
    assert body["role"] == "instructor"
    assert body["student_id"] is None
    assert any(user["id"] == "inst-identity" for user in client.get("/api/demo/users").json())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_identity.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.identity'`

- [ ] **Step 3: Implement `identity.py`**

```python
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
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
    db: Annotated[Session, Depends(get_db)],
    x_farq_user: Annotated[str | None, Header()] = None,
) -> User:
    """The single identity seam. Microsoft sign-in replaces only this function."""
    user = resolve_user(db, x_farq_user)
    if user is None:
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
```

- [ ] **Step 4: Wire it into `main.py`**

Add next to `from .projects import router as projects_router`:

```python
from .identity import router as identity_router
```

Add after `app.include_router(projects_router)`:

```python
app.include_router(identity_router)
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_identity.py -v`
Expected: 3 passed. Then run `.venv/Scripts/python -m pytest services/api/tests -q`. Expected: 95 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/identity.py services/api/app/main.py services/api/tests/team_world.py services/api/tests/test_teams_identity.py
git commit -m "feat(teams): add demo identity seam with users table and X-Farq-User

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Team tables and the permission table

**Files:**
- Create: `services/api/app/teams/__init__.py`, `services/api/app/teams/models.py`, `services/api/app/teams/common.py`, `services/api/app/teams/policy.py`
- Modify: `services/api/app/main.py` (import the package so the tables are registered)
- Modify: `services/api/tests/team_world.py` (add `make_world`, `events_for`)
- Create: `services/api/tests/test_teams_policy.py`

**Interfaces:**
- Consumes: `User` (Task 1), `uid`, `now` from `app.models`, `Base`, `get_db`.
- Produces: all ORM classes below; `common.Db`, `aware(dt)`, `iso(dt) -> str | None`, `loads(text, default)`, `require(db, model, id, label)`, `require_team(db, team_id) -> Team`; `policy.team_role(db, user, team) -> "lead"|"member"|"instructor"|None`, `policy.authorize(db, user, team, action) -> str` (actions: `"view"`, `"view_chat"`, `"write"`, `"lead"`; raises 403), `policy.is_member(role) -> bool`.
- Produces for tests: `make_world(students=4, team_members=3, size_max=4) -> dict` with keys `course_id, assignment_id, team_id, students, instructor, outsider`; `events_for(team_id) -> list[dict]` with keys `seq, type, actor, visible_to, payload`.

- [ ] **Step 1: Write the failing tests**

Append to `services/api/tests/team_world.py`:

```python
import json  # noqa: E402

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.identity import User  # noqa: E402
from app.models import Student  # noqa: E402
from app.teams.models import Assignment, Course, CourseEnrollment, Team, TeamEvent, TeamMember  # noqa: E402


def make_world(students: int = 4, team_members: int = 3, size_max: int = 4) -> dict:
    """A fresh course with an instructor, `students` enrolled students, one
    outsider (not enrolled), one assignment and, when `team_members` > 0, a
    team led by the first student containing the first `team_members`."""
    tag = uuid.uuid4().hex[:8]
    db = SessionLocal()
    try:
        course = Course(code=f"T{tag}", title="Test course", term="Fall 2026")
        db.add(course)
        instructor = User(id=f"inst-{tag}", display_name="Dr. Test", role="instructor")
        db.add(instructor)
        ids = []
        for index in range(students):
            student_id = f"s{index}-{tag}"
            db.add(Student(id=student_id, display_name=f"Student {index} {tag}"))
            db.flush()
            db.add(User(id=student_id, display_name=f"Student {index} {tag}", role="student", student_id=student_id))
            ids.append(student_id)
        outsider = f"out-{tag}"
        db.add(Student(id=outsider, display_name=f"Outsider {tag}"))
        db.flush()
        db.add(User(id=outsider, display_name=f"Outsider {tag}", role="student", student_id=outsider))
        db.flush()
        db.add(CourseEnrollment(course_id=course.id, user_id=instructor.id, role="instructor"))
        for student_id in ids:
            db.add(CourseEnrollment(course_id=course.id, user_id=student_id, role="student"))
        assignment = Assignment(course_id=course.id, title="Term project", team_size_min=2, team_size_max=size_max, deliverables_json='["srs"]')
        db.add(assignment)
        db.flush()
        team_id = None
        if team_members:
            team = Team(assignment_id=assignment.id, name=f"Team {tag}", cover_seed=tag, lead_user_id=ids[0])
            db.add(team)
            db.flush()
            for student_id in ids[:team_members]:
                db.add(TeamMember(team_id=team.id, user_id=student_id))
            team_id = team.id
        db.commit()
        return {"course_id": course.id, "assignment_id": assignment.id, "team_id": team_id, "students": ids, "instructor": instructor.id, "outsider": outsider}
    finally:
        db.close()


def events_for(team_id: str) -> list[dict]:
    db = SessionLocal()
    try:
        rows = db.scalars(select(TeamEvent).where(TeamEvent.team_id == team_id).order_by(TeamEvent.seq)).all()
        return [{"seq": row.seq, "type": row.type, "actor": row.actor_user_id, "visible_to": row.visible_to_user_id, "payload": json.loads(row.payload_json)} for row in rows]
    finally:
        db.close()
```

`services/api/tests/test_teams_policy.py`:

```python
import pytest
from fastapi import HTTPException

from team_world import client, make_world  # noqa: F401

from app.database import SessionLocal
from app.identity import User
from app.teams.models import Team
from app.teams.policy import authorize

CASES = [
    ("lead", "view", True), ("lead", "view_chat", True), ("lead", "write", True), ("lead", "lead", True),
    ("member", "view", True), ("member", "view_chat", True), ("member", "write", True), ("member", "lead", False),
    ("instructor", "view", True), ("instructor", "view_chat", False), ("instructor", "write", False), ("instructor", "lead", False),
    ("classmate", "view", False), ("outsider", "view", False),
]


@pytest.mark.parametrize(("who", "action", "allowed"), CASES)
def test_permission_table(client, who, action, allowed):
    world = make_world(students=4, team_members=2)
    user_id = {
        "lead": world["students"][0], "member": world["students"][1], "classmate": world["students"][2],
        "instructor": world["instructor"], "outsider": world["outsider"],
    }[who]
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        team = db.get(Team, world["team_id"])
        if allowed:
            assert authorize(db, user, team, action) in {"lead", "member", "instructor"}
        else:
            with pytest.raises(HTTPException) as error:
                authorize(db, user, team, action)
            assert error.value.status_code == 403
    finally:
        db.close()


def test_instructor_of_another_course_is_an_outsider(client):
    mine, other = make_world(), make_world()
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as error:
            authorize(db, db.get(User, other["instructor"]), db.get(Team, mine["team_id"]), "view")
        assert error.value.status_code == 403
    finally:
        db.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_policy.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.teams'`

- [ ] **Step 3: Implement the models**

`services/api/app/teams/models.py`:

```python
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..identity import User  # noqa: F401  (registers the users table for the FKs below)
from ..models import now, uid


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_course_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    term: Mapped[str] = mapped_column(String(40), default="")
    # manual | blackboard
    source: Mapped[str] = mapped_column(String(16), default="manual")
    external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_course_enrollment"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    # student | instructor
    role: Mapped[str] = mapped_column(String(16), default="student")


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_assignment_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    # ProjectBrief shape (services/api/app/schemas.py)
    brief_json: Mapped[str] = mapped_column(Text, default="{}")
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deliverables_json: Mapped[str] = mapped_column(Text, default="[]")
    rubric_json: Mapped[str] = mapped_column(Text, default="[]")
    team_size_min: Mapped[int] = mapped_column(Integer, default=2)
    team_size_max: Mapped[int] = mapped_column(Integer, default=4)
    source: Mapped[str] = mapped_column(String(16), default="manual")
    external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    cover_seed: Mapped[str] = mapped_column(String(16))
    lead_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    charter_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role_label: Mapped[str] = mapped_column(String(40), default="")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen_seq: Mapped[int] = mapped_column(Integer, default=0)


class TeamInvite(Base):
    __tablename__ = "team_invites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    invited_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    invited_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    # pending | accepted | declined
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Milestone(Base):
    __tablename__ = "milestones"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deliverable_key: Mapped[str | None] = mapped_column(String(24), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    # todo | doing | review | done
    status: Mapped[str] = mapped_column(String(16), default="todo", index=True)
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    estimate_points: Mapped[int] = mapped_column(Integer, default=1)
    due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    depends_on_json: Mapped[str] = mapped_column(Text, default="[]")
    milestone_id: Mapped[str | None] = mapped_column(ForeignKey("milestones.id"), nullable=True, index=True)
    rubric_refs_json: Mapped[str] = mapped_column(Text, default="[]")
    rationale: Mapped[str] = mapped_column(Text, default="")
    # user | hermes
    created_by: Mapped[str] = mapped_column(String(16), default="user")
    position: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    source_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    pinned_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamMessage(Base):
    __tablename__ = "team_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    # None means Hermes (or the system for kind="system").
    author_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # text | notice | proposal | poll | system
    kind: Mapped[str] = mapped_column(String(16), default="text")
    content: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_to_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Set for private notices and catch-ups; None means the whole team.
    visible_to_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(ForeignKey("team_messages.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    emoji: Mapped[str] = mapped_column(String(16))


class TeamDocument(Base):
    __tablename__ = "team_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    # srs | sds | spmp | custom
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DocSection(Base):
    __tablename__ = "doc_sections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    document_id: Mapped[str] = mapped_column(ForeignKey("team_documents.id"), index=True)
    key: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(160))
    position: Mapped[int] = mapped_column(Integer, default=0)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    content_md: Mapped[str] = mapped_column(Text, default="")
    # empty | draft | accepted
    status: Mapped[str] = mapped_column(String(16), default="empty")
    lock_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    lock_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    meta_json: Mapped[str] = mapped_column(Text, default="{}")


class TeamEvent(Base):
    """Append-only team log. Written in the same transaction as the change it
    describes; the SSE stream, catch-up, replay and contribution read it."""

    __tablename__ = "team_events"
    __table_args__ = {"sqlite_autoincrement": True}
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    type: Mapped[str] = mapped_column(String(40))
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    visible_to_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
```

> Note: `team_events.visible_to_user_id` is not listed in spec §4. It is needed for the spec §6 rule that private events are dropped from other viewers' streams.

- [ ] **Step 4: Implement `common.py`, `policy.py` and the package `__init__.py`**

`services/api/app/teams/common.py`:

```python
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .models import Team

Db = Annotated[Session, Depends(get_db)]


def aware(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; everything Farq stores is UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def iso(value: datetime | None) -> str | None:
    value = aware(value)
    return value.isoformat() if value else None


def loads(text: str | None, default: Any) -> Any:
    if not text:
        return default
    try:
        return json.loads(text)
    except ValueError:
        return default


def require(db: Session, model, item_id: str, label: str):
    item = db.get(model, item_id)
    if item is None:
        raise HTTPException(404, f"{label} not found")
    return item


def require_team(db: Session, team_id: str) -> Team:
    return require(db, Team, team_id, "Team")
```

`services/api/app/teams/policy.py`:

```python
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import User
from .models import Assignment, CourseEnrollment, Team, TeamMember

# Who may do what inside a team. Chat ("view_chat") is members only: course
# instructors see everything else (docs/superpowers/specs/2026-09-25-group-projects-design.md §5).
ACTIONS: dict[str, set[str]] = {
    "view": {"member", "instructor"},
    "view_chat": {"member"},
    "write": {"member"},
    "lead": {"lead"},
}


def team_role(db: Session, user: User, team: Team) -> str | None:
    if db.scalar(select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id)):
        return "lead" if team.lead_user_id == user.id else "member"
    assignment = db.get(Assignment, team.assignment_id)
    if assignment is not None and db.scalar(
        select(CourseEnrollment.id).where(
            CourseEnrollment.course_id == assignment.course_id,
            CourseEnrollment.user_id == user.id,
            CourseEnrollment.role == "instructor",
        )
    ):
        return "instructor"
    return None


def is_member(role: str | None) -> bool:
    return role in {"member", "lead"}


def authorize(db: Session, user: User, team: Team, action: str) -> str:
    """Return the viewer's role in the team, or raise 403."""
    role = team_role(db, user, team)
    held = {role, "member"} if role == "lead" else {role}
    if role is None or not held & ACTIONS[action]:
        raise HTTPException(403, "You don't have access to this part of the team")
    return role
```

`services/api/app/teams/__init__.py`:

```python
from . import models  # noqa: F401  (registers the team tables with Base.metadata)
```

In `services/api/app/main.py`, add after `from .identity import router as identity_router`:

```python
from . import teams  # noqa: F401  (registers the team tables before create_all)
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_policy.py -v`
Expected: 15 passed. Then run `.venv/Scripts/python -m pytest services/api/tests -q`. Expected: 110 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/app/main.py services/api/tests/team_world.py services/api/tests/test_teams_policy.py
git commit -m "feat(teams): add course, team, task, chat and doc tables with the permission table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Event log and SSE stream

**Files:**
- Create: `services/api/app/teams/events.py`
- Modify: `services/api/app/teams/__init__.py` (aggregate routers)
- Modify: `services/api/app/main.py` (replace the bare package import with the router)
- Create: `services/api/tests/test_teams_events.py`

**Interfaces:**
- Consumes: `TeamEvent`, `require_team`, `authorize`, `resolve_user`.
- Produces: `emit(db, team_id, type, actor_user_id, payload, *, visible_to_user_id=None, created_at=None) -> TeamEvent` (adds, does not commit); `events_after(db, team_id, after_seq, user_id, role, limit=200) -> tuple[list[TeamEvent], int]` (the int is the new cursor); `event_dict(event) -> dict` with keys `seq, type, actor_user_id, payload, created_at`; `sse_frame(event) -> str`; module constants `POLL_SECONDS`, `HEARTBEAT_SECONDS`, `MAX_POLLS`; `GET /api/teams/{team_id}/events?as=<user>&after=<seq>` (honours the `Last-Event-ID` header).

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_events.py`:

```python
import re

import pytest

from team_world import client, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams import events
from app.teams.events import emit


@pytest.fixture(autouse=True)
def one_poll(monkeypatch):
    monkeypatch.setattr(events, "MAX_POLLS", 1)
    monkeypatch.setattr(events, "POLL_SECONDS", 0)


def _emit(team_id, type_, actor, payload, visible_to=None) -> int:
    db = SessionLocal()
    try:
        event = emit(db, team_id, type_, actor, payload, visible_to_user_id=visible_to)
        db.commit()
        return event.seq
    finally:
        db.close()


def _stream(client, team_id, user_id, headers=None, **params):
    query = {"as": user_id, **params} if user_id else params
    return client.get(f"/api/teams/{team_id}/events", params=query, headers=headers or {})


def _seqs(text: str) -> list[int]:
    return [int(value) for value in re.findall(r"^id: (\d+)$", text, re.M)]


def test_member_sees_team_and_own_private_events(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    task = _emit(team, "task.created", s0, {"id": "t1"})
    message = _emit(team, "message.created", s0, {"id": "m1"})
    _emit(team, "notice.created", None, {"text": "for s1"}, visible_to=s1)
    mine = _emit(team, "notice.created", None, {"text": "for s0"}, visible_to=s0)
    response = _stream(client, team, s0)
    assert response.status_code == 200, response.text
    assert _seqs(response.text) == [task, message, mine]
    assert '"payload": {"id": "t1"}' in response.text


def test_instructor_never_receives_chat_or_private_events(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    task = _emit(team, "task.created", s0, {"id": "t1"})
    _emit(team, "message.created", s0, {"id": "m1"})
    _emit(team, "reaction.toggled", s0, {"message_id": "m1"})
    _emit(team, "notice.created", None, {"text": "private"}, visible_to=s0)
    decision = _emit(team, "decision.pinned", s0, {"text": "Use FastAPI"})
    assert _seqs(_stream(client, team, world["instructor"]).text) == [task, decision]


def test_stream_resumes_after_last_event_id(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    first, second, third = (_emit(team, "task.created", s0, {"n": n}) for n in range(3))
    assert _seqs(_stream(client, team, s0, headers={"Last-Event-ID": str(first)}).text) == [second, third]
    assert _seqs(_stream(client, team, s0, after=second).text) == [third]


def test_stream_requires_a_known_viewer_with_access(client):
    world = make_world()
    team = world["team_id"]
    assert _stream(client, team, None).status_code == 401
    assert _stream(client, team, world["outsider"]).status_code == 403
    assert _stream(client, "no-such-team", world["students"][0]).status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_events.py -v`
Expected: FAIL with `ImportError: cannot import name 'events' from 'app.teams'`

- [ ] **Step 3: Implement `events.py`**

```python
from __future__ import annotations

import json
import time
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..identity import resolve_user
from .common import Db, iso, loads, require_team
from .models import TeamEvent
from .policy import authorize

# Event types an instructor must never receive (spec §5: the chat is private).
CHAT_PREFIXES = ("message.", "reaction.", "typing.")
POLL_SECONDS = 0.4
HEARTBEAT_SECONDS = 15
# Tests set this to stop the otherwise endless stream after N polls.
MAX_POLLS: int | None = None

router = APIRouter()


def emit(
    db: Session,
    team_id: str,
    type_: str,
    actor_user_id: str | None,
    payload: dict,
    *,
    visible_to_user_id: str | None = None,
    created_at: datetime | None = None,
) -> TeamEvent:
    """Add one event in the caller's transaction (transactional outbox)."""
    event = TeamEvent(
        team_id=team_id, type=type_, actor_user_id=actor_user_id, visible_to_user_id=visible_to_user_id,
        payload_json=json.dumps(payload, ensure_ascii=False, default=str),
    )
    if created_at is not None:
        event.created_at = created_at
    db.add(event)
    db.flush()
    return event


def _visible(event: TeamEvent, user_id: str, role: str) -> bool:
    if event.visible_to_user_id and event.visible_to_user_id != user_id:
        return False
    if role == "instructor" and (event.type.startswith(CHAT_PREFIXES) or event.visible_to_user_id):
        return False
    return True


def events_after(db: Session, team_id: str, after_seq: int, user_id: str, role: str, limit: int = 200) -> tuple[list[TeamEvent], int]:
    rows = db.scalars(
        select(TeamEvent).where(TeamEvent.team_id == team_id, TeamEvent.seq > after_seq).order_by(TeamEvent.seq).limit(limit)
    ).all()
    cursor = rows[-1].seq if rows else after_seq
    return [row for row in rows if _visible(row, user_id, role)], cursor


def event_dict(event: TeamEvent) -> dict:
    return {
        "seq": event.seq, "type": event.type, "actor_user_id": event.actor_user_id,
        "payload": loads(event.payload_json, {}), "created_at": iso(event.created_at),
    }


def sse_frame(event: TeamEvent) -> str:
    return f"id: {event.seq}\nevent: {event.type}\ndata: {json.dumps(event_dict(event), ensure_ascii=False)}\n\n"


@router.get("/api/teams/{team_id}/events")
def team_event_stream(
    team_id: str,
    db: Db,
    as_user: Annotated[str | None, Query(alias="as")] = None,
    after: int = 0,
    last_event_id: Annotated[str | None, Header()] = None,
):
    # EventSource cannot send headers, so the demo stream names its viewer in
    # the query. Microsoft sign-in will replace this with the session cookie.
    user = resolve_user(db, as_user)
    if user is None:
        raise HTTPException(401, "Choose who you are with the View as switcher")
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    start = int(last_event_id) if last_event_id and last_event_id.isdigit() else after
    user_id = user.id

    def stream():
        cursor, polls, last_beat = start, 0, time.monotonic()
        yield "retry: 2000\n\n"
        while True:
            session = SessionLocal()
            try:
                rows, cursor = events_after(session, team_id, cursor, user_id, role)
                frames = [sse_frame(row) for row in rows]
            finally:
                session.close()
            yield from frames
            if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                yield ": keep-alive\n\n"
                last_beat = time.monotonic()
            polls += 1
            if MAX_POLLS is not None and polls >= MAX_POLLS:
                return
            time.sleep(POLL_SECONDS)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
```

- [ ] **Step 4: Aggregate the routers and include them in `main.py`**

Replace `services/api/app/teams/__init__.py` with:

```python
from fastapi import APIRouter

from . import models  # noqa: F401  (registers the team tables with Base.metadata)
from .events import router as events_router

router = APIRouter()
router.include_router(events_router)
```

In `services/api/app/main.py`, replace `from . import teams  # noqa: F401 ...` with:

```python
from .teams import router as teams_router
```

and add after `app.include_router(identity_router)`:

```python
app.include_router(teams_router)
```

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_events.py -v`
Expected: 4 passed. Full suite: 114 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/app/main.py services/api/tests/test_teams_events.py
git commit -m "feat(teams): add transactional event log and role-filtered SSE stream

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Teams home, team creation, invites and team detail

**Files:**
- Create: `services/api/app/teams/teams.py`
- Modify: `services/api/app/teams/__init__.py`
- Create: `services/api/tests/test_teams_home.py`

**Interfaces:**
- Consumes: `emit`, `authorize`, `is_member`, `require`, `require_team`, `iso`, `loads`, `CurrentUser`, `user_dict`.
- Produces: `course_dict(course)`, `assignment_dict(assignment)`, `member_dicts(db, team) -> list[dict]` (keys `user_id, display_name, role_label, is_lead`), `team_dict(db, team, viewer_role) -> dict` (keys `id, name, cover_seed, lead_user_id, charter, created_at, viewer_role, assignment, course, members`), `team_card(db, team, user, role) -> dict` (keys `id, name, cover_seed, course, assignment{id,title,deadline}, progress, next_task, members, unread, viewer_role`), `team_for_assignment(db, assignment_id, user_id) -> Team | None`.
- Endpoints: `GET /api/me/teams-home`, `POST /api/assignments/{id}/teams` (201), `POST /api/teams/{id}/invites` (201), `POST /api/invites/{id}/accept`, `POST /api/invites/{id}/decline`, `GET /api/teams/{id}`.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_home.py`:

```python
from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import Assignment


def test_home_lists_my_team_and_assignments_without_a_team(client):
    world = make_world(students=4, team_members=2)
    db = SessionLocal()
    try:
        extra = Assignment(course_id=world["course_id"], title="Second project", team_size_min=2, team_size_max=3)
        db.add(extra)
        db.commit()
        extra_id = extra.id
    finally:
        db.close()
    home = client.get("/api/me/teams-home", headers=hdr(world["students"][0])).json()
    card = next(item for item in home["teams"] if item["id"] == world["team_id"])
    assert card["viewer_role"] == "lead"
    assert card["progress"] == 0
    assert card["unread"] == 0
    assert card["next_task"] is None
    needs = [item["assignment_id"] for item in home["needs_team"]]
    assert extra_id in needs
    assert world["assignment_id"] not in needs
    assert next(item for item in home["needs_team"] if item["assignment_id"] == extra_id)["open_classmates"] == 3


def test_instructor_home_shows_every_team_in_the_course(client):
    world = make_world(students=4, team_members=2)
    second = client.post(f"/api/assignments/{world['assignment_id']}/teams", json={"name": "Second team"}, headers=hdr(world["students"][2]))
    assert second.status_code == 201, second.text
    home = client.get("/api/me/teams-home", headers=hdr(world["instructor"])).json()
    ids = {item["id"] for item in home["teams"] if item["course"]["id"] == world["course_id"]}
    assert ids == {world["team_id"], second.json()["id"]}
    assert all(item["unread"] is None for item in home["teams"])
    assert home["needs_team"] == []


def test_team_creation_rules(client):
    world = make_world(students=4, team_members=2)
    url = f"/api/assignments/{world['assignment_id']}/teams"
    assert client.post(url, json={"name": "Nope"}, headers=hdr(world["instructor"])).status_code == 403
    assert client.post(url, json={"name": "Nope"}, headers=hdr(world["outsider"])).status_code == 403
    assert client.post(url, json={"name": "Again"}, headers=hdr(world["students"][0])).status_code == 409
    created = client.post(url, json={"name": "  Falcons  "}, headers=hdr(world["students"][2]))
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Falcons"
    assert body["lead_user_id"] == world["students"][2]
    assert len(body["cover_seed"]) == 12
    assert [event["type"] for event in events_for(body["id"])] == ["member.joined"]


def test_invites_respect_enrollment_and_team_size(client):
    world = make_world(students=5, team_members=2, size_max=3)
    s0, s1, s2, s3, _ = world["students"]
    url = f"/api/teams/{world['team_id']}/invites"
    assert client.post(url, json={"user_id": world["outsider"]}, headers=hdr(s0)).status_code == 422
    assert client.post(url, json={"user_id": s1}, headers=hdr(s0)).status_code == 409
    invite = client.post(url, json={"user_id": s2}, headers=hdr(s0))
    assert invite.status_code == 201, invite.text
    assert client.post(url, json={"user_id": s2}, headers=hdr(s0)).status_code == 409
    assert client.post(url, json={"user_id": s3}, headers=hdr(s0)).status_code == 409
    assert client.post(f"/api/invites/{invite.json()['id']}/accept", headers=hdr(s3)).status_code == 403
    accepted = client.post(f"/api/invites/{invite.json()['id']}/accept", headers=hdr(s2))
    assert accepted.status_code == 200, accepted.text
    assert {member["user_id"] for member in accepted.json()["members"]} == {s0, s1, s2}
    assert "member.joined" in [event["type"] for event in events_for(world["team_id"])]


def test_accepting_is_refused_when_already_on_another_team(client):
    world = make_world(students=4, team_members=1)
    s0, s1 = world["students"][:2]
    invite = client.post(f"/api/teams/{world['team_id']}/invites", json={"user_id": s1}, headers=hdr(s0)).json()
    own = client.post(f"/api/assignments/{world['assignment_id']}/teams", json={"name": "Solo"}, headers=hdr(s1))
    assert own.status_code == 201
    assert client.post(f"/api/invites/{invite['id']}/accept", headers=hdr(s1)).status_code == 409


def test_team_detail_is_hidden_from_outsiders(client):
    world = make_world()
    url = f"/api/teams/{world['team_id']}"
    assert client.get(url, headers=hdr(world["outsider"])).status_code == 403
    assert client.get(url, headers=hdr(world["students"][1])).json()["viewer_role"] == "member"
    instructor_view = client.get(url, headers=hdr(world["instructor"])).json()
    assert instructor_view["viewer_role"] == "instructor"
    assert instructor_view["assignment"]["team_size_max"] == 4
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_home.py -v`
Expected: FAIL with 404 responses (the routes don't exist yet).

- [ ] **Step 3: Implement `teams.py`**

```python
from __future__ import annotations

import hashlib

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..identity import CurrentUser, User, user_dict
from ..models import uid
from .common import Db, iso, loads, require, require_team
from .events import emit
from .models import Assignment, Course, CourseEnrollment, Task, Team, TeamEvent, TeamInvite, TeamMember
from .policy import authorize, is_member

router = APIRouter()
STATUS_RANK = {"doing": 0, "review": 1, "todo": 2}


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)


class InviteCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=36)


def course_dict(course: Course) -> dict:
    return {"id": course.id, "code": course.code, "title": course.title, "term": course.term}


def assignment_dict(assignment: Assignment) -> dict:
    return {
        "id": assignment.id, "course_id": assignment.course_id, "title": assignment.title,
        "brief": loads(assignment.brief_json, {}), "deadline": iso(assignment.deadline),
        "deliverables": loads(assignment.deliverables_json, []), "rubric": loads(assignment.rubric_json, []),
        "team_size_min": assignment.team_size_min, "team_size_max": assignment.team_size_max,
    }


def _members(db: Session, team_id: str) -> list[TeamMember]:
    return db.scalars(select(TeamMember).where(TeamMember.team_id == team_id).order_by(TeamMember.joined_at)).all()


def member_dicts(db: Session, team: Team) -> list[dict]:
    result = []
    for member in _members(db, team.id):
        user = db.get(User, member.user_id)
        result.append({
            "user_id": member.user_id, "display_name": user.display_name if user else member.user_id,
            "role_label": member.role_label, "is_lead": member.user_id == team.lead_user_id,
        })
    return result


def team_dict(db: Session, team: Team, viewer_role: str) -> dict:
    assignment = db.get(Assignment, team.assignment_id)
    return {
        "id": team.id, "name": team.name, "cover_seed": team.cover_seed, "lead_user_id": team.lead_user_id,
        "charter": loads(team.charter_json, {}), "created_at": iso(team.created_at), "viewer_role": viewer_role,
        "assignment": assignment_dict(assignment), "course": course_dict(db.get(Course, assignment.course_id)),
        "members": member_dicts(db, team),
    }


def team_for_assignment(db: Session, assignment_id: str, user_id: str) -> Team | None:
    return db.scalar(
        select(Team).join(TeamMember, TeamMember.team_id == Team.id)
        .where(Team.assignment_id == assignment_id, TeamMember.user_id == user_id)
    )


def _enrollment(db: Session, course_id: str, user_id: str) -> CourseEnrollment | None:
    return db.scalar(select(CourseEnrollment).where(CourseEnrollment.course_id == course_id, CourseEnrollment.user_id == user_id))


def team_card(db: Session, team: Team, user: User, role: str) -> dict:
    assignment = db.get(Assignment, team.assignment_id)
    tasks = db.scalars(select(Task).where(Task.team_id == team.id)).all()
    total = sum(task.estimate_points for task in tasks)
    done = sum(task.estimate_points for task in tasks if task.status == "done")
    next_task, unread = None, None
    if is_member(role):
        mine = [task for task in tasks if task.assignee_id == user.id and task.status != "done"]
        mine.sort(key=lambda task: (STATUS_RANK.get(task.status, 3), iso(task.due) or "9999", task.position))
        if mine:
            next_task = {"id": mine[0].id, "title": mine[0].title, "estimate_points": mine[0].estimate_points, "status": mine[0].status}
        member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
        unread = db.scalar(
            select(func.count()).select_from(TeamEvent).where(
                TeamEvent.team_id == team.id, TeamEvent.seq > member.last_seen_seq, TeamEvent.type == "message.created",
                (TeamEvent.actor_user_id.is_(None)) | (TeamEvent.actor_user_id != user.id),
                (TeamEvent.visible_to_user_id.is_(None)) | (TeamEvent.visible_to_user_id == user.id),
            )
        )
    return {
        "id": team.id, "name": team.name, "cover_seed": team.cover_seed,
        "course": course_dict(db.get(Course, assignment.course_id)),
        "assignment": {"id": assignment.id, "title": assignment.title, "deadline": iso(assignment.deadline)},
        "progress": round(100 * done / total) if total else 0, "next_task": next_task,
        "members": [member.user_id for member in _members(db, team.id)], "unread": unread, "viewer_role": role,
    }


def invite_dict(db: Session, invite: TeamInvite) -> dict:
    team = db.get(Team, invite.team_id)
    assignment = db.get(Assignment, team.assignment_id)
    inviter = db.get(User, invite.invited_by)
    return {
        "id": invite.id, "team_id": team.id, "team_name": team.name, "assignment_title": assignment.title,
        "invited_user_id": invite.invited_user_id, "invited_by_name": inviter.display_name if inviter else "",
        "status": invite.status, "created_at": iso(invite.created_at),
    }


@router.get("/api/me/teams-home")
def teams_home(db: Db, user: CurrentUser) -> dict:
    cards, needs = [], []
    for enrollment in db.scalars(select(CourseEnrollment).where(CourseEnrollment.user_id == user.id)).all():
        course = db.get(Course, enrollment.course_id)
        for assignment in db.scalars(select(Assignment).where(Assignment.course_id == course.id).order_by(Assignment.deadline)).all():
            if enrollment.role == "instructor":
                for team in db.scalars(select(Team).where(Team.assignment_id == assignment.id).order_by(Team.name)).all():
                    cards.append(team_card(db, team, user, "instructor"))
                continue
            team = team_for_assignment(db, assignment.id, user.id)
            if team is not None:
                cards.append(team_card(db, team, user, "lead" if team.lead_user_id == user.id else "member"))
                continue
            classmates = db.scalars(select(CourseEnrollment.user_id).where(
                CourseEnrollment.course_id == course.id, CourseEnrollment.role == "student", CourseEnrollment.user_id != user.id,
            )).all()
            open_count = sum(1 for classmate in classmates if team_for_assignment(db, assignment.id, classmate) is None)
            needs.append({
                "assignment_id": assignment.id, "title": assignment.title, "deadline": iso(assignment.deadline),
                "course": course_dict(course), "team_size_min": assignment.team_size_min,
                "team_size_max": assignment.team_size_max, "open_classmates": open_count,
            })
    invites = db.scalars(select(TeamInvite).where(TeamInvite.invited_user_id == user.id, TeamInvite.status == "pending")).all()
    return {"user": user_dict(user), "teams": cards, "needs_team": needs, "invites": [invite_dict(db, item) for item in invites]}


@router.post("/api/assignments/{assignment_id}/teams", status_code=201)
def create_team(assignment_id: str, body: TeamCreate, db: Db, user: CurrentUser) -> dict:
    assignment = require(db, Assignment, assignment_id, "Assignment")
    enrollment = _enrollment(db, assignment.course_id, user.id)
    if enrollment is None or enrollment.role != "student":
        raise HTTPException(403, "Only students enrolled in this course can form a team")
    if team_for_assignment(db, assignment.id, user.id) is not None:
        raise HTTPException(409, "You already have a team for this assignment")
    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(422, "Give your team a name")
    seed = hashlib.sha256(f"{name}:{uid()}".encode()).hexdigest()[:12]
    team = Team(assignment_id=assignment.id, name=name, cover_seed=seed, lead_user_id=user.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id, role_label="Lead"))
    emit(db, team.id, "member.joined", user.id, {"user_id": user.id, "display_name": user.display_name})
    db.commit()
    return team_dict(db, team, "lead")


@router.post("/api/teams/{team_id}/invites", status_code=201)
def invite_member(team_id: str, body: InviteCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    assignment = db.get(Assignment, team.assignment_id)
    enrollment = _enrollment(db, assignment.course_id, body.user_id)
    if db.get(User, body.user_id) is None or enrollment is None or enrollment.role != "student":
        raise HTTPException(422, "Only classmates in this course can be invited")
    if team_for_assignment(db, assignment.id, body.user_id) is not None:
        raise HTTPException(409, "They already have a team for this assignment")
    pending = db.scalars(select(TeamInvite).where(TeamInvite.team_id == team.id, TeamInvite.status == "pending")).all()
    if any(item.invited_user_id == body.user_id for item in pending):
        raise HTTPException(409, "They already have a pending invite")
    if len(_members(db, team.id)) + len(pending) >= assignment.team_size_max:
        raise HTTPException(409, "This team is full")
    invite = TeamInvite(team_id=team.id, invited_user_id=body.user_id, invited_by=user.id)
    db.add(invite)
    db.flush()
    emit(db, team.id, "invite.created", user.id, invite_dict(db, invite))
    db.commit()
    return invite_dict(db, invite)


def _pending_invite_for(db: Session, invite_id: str, user: User) -> TeamInvite:
    invite = require(db, TeamInvite, invite_id, "Invite")
    if invite.invited_user_id != user.id:
        raise HTTPException(403, "This invite is for someone else")
    if invite.status != "pending":
        raise HTTPException(409, "This invite was already answered")
    return invite


@router.post("/api/invites/{invite_id}/accept")
def accept_invite(invite_id: str, db: Db, user: CurrentUser) -> dict:
    invite = _pending_invite_for(db, invite_id, user)
    team = db.get(Team, invite.team_id)
    assignment = db.get(Assignment, team.assignment_id)
    if team_for_assignment(db, assignment.id, user.id) is not None:
        raise HTTPException(409, "You already joined a team for this assignment")
    if len(_members(db, team.id)) >= assignment.team_size_max:
        raise HTTPException(409, "This team filled up")
    db.add(TeamMember(team_id=team.id, user_id=user.id))
    invite.status = "accepted"
    emit(db, team.id, "member.joined", user.id, {"user_id": user.id, "display_name": user.display_name})
    db.commit()
    return team_dict(db, team, "member")


@router.post("/api/invites/{invite_id}/decline")
def decline_invite(invite_id: str, db: Db, user: CurrentUser) -> dict:
    invite = _pending_invite_for(db, invite_id, user)
    invite.status = "declined"
    emit(db, invite.team_id, "invite.declined", user.id, {"id": invite.id, "user_id": user.id})
    db.commit()
    return invite_dict(db, invite)


@router.get("/api/teams/{team_id}")
def get_team(team_id: str, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    return team_dict(db, team, authorize(db, user, team, "view"))
```

- [ ] **Step 4: Register the router**

In `services/api/app/teams/__init__.py`, add `from .teams import router as teams_router` below the events import, and `router.include_router(teams_router)` below the events include.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_home.py -v`
Expected: 6 passed. Full suite: 120 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/tests/test_teams_home.py
git commit -m "feat(teams): add teams home, team creation, invites and team detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Team chat, polls, reactions, decisions and the seen pointer

**Files:**
- Create: `services/api/app/teams/chat.py`
- Modify: `services/api/app/teams/__init__.py`
- Create: `services/api/tests/test_teams_chat.py`

**Interfaces:**
- Consumes: `emit`, `events_after`, `authorize`, `require`, `require_team`, `iso`, `loads`, `now`.
- Produces: `message_dict(message, reactions=None) -> dict` (keys `id, team_id, author_user_id, kind, content, metadata, reply_to_id, visible_to_user_id, created_at, edited_at, deleted, reactions`), `reactions_for(db, message_ids) -> dict[str, dict[str, list[str]]]`, `decision_dict(decision) -> dict`, `post_message(db, team_id, author_user_id, content, *, kind="text", metadata=None, reply_to_id=None, visible_to_user_id=None, created_at=None) -> TeamMessage` (emits `message.created`, does not commit).
- Endpoints: `POST /api/teams/{id}/messages` (201), `PATCH /api/messages/{id}`, `DELETE /api/messages/{id}`, `POST /api/messages/{id}/reactions`, `POST /api/messages/{id}/poll-vote`, `POST /api/teams/{id}/decisions` (201), `DELETE /api/decisions/{id}`, `POST /api/teams/{id}/seen`.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_chat.py`:

```python
from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.events import events_after


def _post(client, team_id, user_id, **body):
    return client.post(f"/api/teams/{team_id}/messages", json=body, headers=hdr(user_id))


def test_posting_keeps_arabic_text_and_emits_one_event(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    before = len(events_for(team))
    text = "هل يمكن لأحد تقسيم متطلبات SRS؟ 🙏"
    response = _post(client, team, s0, content=text)
    assert response.status_code == 201, response.text
    assert response.json()["content"] == text
    new = events_for(team)[before:]
    assert [event["type"] for event in new] == ["message.created"]
    assert new[0]["payload"]["content"] == text


def test_rejected_messages_emit_nothing(client):
    world = make_world()
    team = world["team_id"]
    before = len(events_for(team))
    assert _post(client, team, world["students"][0], content="   ").status_code == 422
    assert _post(client, team, world["instructor"], content="Hello team").status_code == 403
    assert _post(client, team, world["outsider"], content="Hello team").status_code == 403
    assert _post(client, team, world["students"][0], content="Poll?", poll_options=["Only one"]).status_code == 422
    assert len(events_for(team)) == before


def test_polls_and_reactions(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    poll = _post(client, team, s0, content="When do we meet?", poll_options=["Sun 8pm", "Tue 8pm"]).json()
    assert poll["kind"] == "poll"
    voted = client.post(f"/api/messages/{poll['id']}/poll-vote", json={"option": 1}, headers=hdr(s1))
    assert voted.status_code == 200, voted.text
    assert voted.json()["metadata"]["votes"] == {s1: 1}
    assert client.post(f"/api/messages/{poll['id']}/poll-vote", json={"option": 5}, headers=hdr(s1)).status_code == 422
    text = _post(client, team, s0, content="Plain message").json()
    assert client.post(f"/api/messages/{text['id']}/poll-vote", json={"option": 0}, headers=hdr(s1)).status_code == 409
    first = client.post(f"/api/messages/{text['id']}/reactions", json={"emoji": "👍"}, headers=hdr(s1)).json()
    second = client.post(f"/api/messages/{text['id']}/reactions", json={"emoji": "👍"}, headers=hdr(s1)).json()
    assert (first["on"], second["on"]) == (True, False)


def test_only_the_author_edits_or_deletes(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    message = _post(client, team, s0, content="Draft plan").json()
    assert client.patch(f"/api/messages/{message['id']}", json={"content": "Hacked"}, headers=hdr(s1)).status_code == 403
    edited = client.patch(f"/api/messages/{message['id']}", json={"content": "Final plan"}, headers=hdr(s0))
    assert edited.status_code == 200
    assert edited.json()["edited_at"] is not None
    assert client.delete(f"/api/messages/{message['id']}", headers=hdr(s1)).status_code == 403
    assert client.delete(f"/api/messages/{message['id']}", headers=hdr(s0)).status_code == 200
    assert events_for(team)[-1]["type"] == "message.deleted"
    assert client.patch(f"/api/messages/{message['id']}", json={"content": "Back"}, headers=hdr(s0)).status_code == 403


def test_pinned_decisions_reach_the_instructor_but_the_message_does_not(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    message = _post(client, team, s0, content="We'll deploy on Render").json()
    decision = client.post(f"/api/teams/{team}/decisions", json={"message_id": message["id"]}, headers=hdr(s1))
    assert decision.status_code == 201, decision.text
    assert decision.json()["text"] == "We'll deploy on Render"
    db = SessionLocal()
    try:
        rows, _ = events_after(db, team, 0, world["instructor"], "instructor")
    finally:
        db.close()
    types = [row.type for row in rows]
    assert "decision.pinned" in types
    assert "message.created" not in types


def test_seen_pointer_only_moves_forward(client):
    world = make_world()
    url = f"/api/teams/{world['team_id']}/seen"
    s0 = world["students"][0]
    assert client.post(url, json={"seq": 10}, headers=hdr(s0)).json()["last_seen_seq"] == 10
    assert client.post(url, json={"seq": 3}, headers=hdr(s0)).json()["last_seen_seq"] == 10
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_chat.py -v`
Expected: FAIL with 404/405 responses (the routes don't exist yet).

- [ ] **Step 3: Implement `chat.py`**

```python
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .common import Db, iso, loads, require, require_team
from .events import emit
from .models import Decision, MessageReaction, TeamMember, TeamMessage
from .policy import authorize

router = APIRouter()


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    reply_to_id: str | None = None
    poll_options: list[str] | None = Field(default=None, max_length=8)


class MessageEdit(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=16)


class PollVote(BaseModel):
    option: int = Field(ge=0)


class DecisionCreate(BaseModel):
    message_id: str


class SeenUpdate(BaseModel):
    seq: int = Field(ge=0)


def reactions_for(db: Session, message_ids: list[str]) -> dict[str, dict[str, list[str]]]:
    grouped: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    if message_ids:
        for reaction in db.scalars(select(MessageReaction).where(MessageReaction.message_id.in_(message_ids))).all():
            grouped[reaction.message_id][reaction.emoji].append(reaction.user_id)
    return {message_id: dict(emojis) for message_id, emojis in grouped.items()}


def message_dict(message: TeamMessage, reactions: dict[str, list[str]] | None = None) -> dict:
    deleted = message.deleted_at is not None
    return {
        "id": message.id, "team_id": message.team_id, "author_user_id": message.author_user_id, "kind": message.kind,
        "content": "" if deleted else message.content,
        "metadata": None if deleted else loads(message.metadata_json, None),
        "reply_to_id": message.reply_to_id, "visible_to_user_id": message.visible_to_user_id,
        "created_at": iso(message.created_at), "edited_at": iso(message.edited_at), "deleted": deleted,
        "reactions": reactions or {},
    }


def decision_dict(decision: Decision) -> dict:
    return {
        "id": decision.id, "team_id": decision.team_id, "text": decision.text,
        "source_message_id": decision.source_message_id, "pinned_by": decision.pinned_by, "created_at": iso(decision.created_at),
    }


def post_message(
    db: Session, team_id: str, author_user_id: str | None, content: str, *,
    kind: str = "text", metadata: dict | None = None, reply_to_id: str | None = None,
    visible_to_user_id: str | None = None, created_at: datetime | None = None,
) -> TeamMessage:
    """Store a message and emit `message.created`. The caller commits."""
    message = TeamMessage(
        team_id=team_id, author_user_id=author_user_id, kind=kind, content=content,
        metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata is not None else None,
        reply_to_id=reply_to_id, visible_to_user_id=visible_to_user_id,
    )
    if created_at is not None:
        message.created_at = created_at
    db.add(message)
    db.flush()
    emit(db, team_id, "message.created", author_user_id, message_dict(message), visible_to_user_id=visible_to_user_id, created_at=created_at)
    return message


def _visible_message(db: Session, message_id: str, user_id: str) -> TeamMessage:
    message = db.get(TeamMessage, message_id)
    if message is None or (message.visible_to_user_id and message.visible_to_user_id != user_id):
        raise HTTPException(404, "Message not found")
    return message


def _emit_edited(db: Session, message: TeamMessage, actor: str) -> dict:
    payload = message_dict(message, reactions_for(db, [message.id]).get(message.id))
    emit(db, message.team_id, "message.edited", actor, payload, visible_to_user_id=message.visible_to_user_id)
    return payload


@router.post("/api/teams/{team_id}/messages", status_code=201)
def create_message(team_id: str, body: MessageCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Message is empty")
    if body.reply_to_id and _visible_message(db, body.reply_to_id, user.id).team_id != team.id:
        raise HTTPException(404, "Message not found")
    kind, metadata = "text", None
    if body.poll_options is not None:
        options = [option.strip()[:120] for option in body.poll_options if option.strip()]
        if len(options) < 2:
            raise HTTPException(422, "A poll needs at least two options")
        kind, metadata = "poll", {"options": options, "votes": {}}
    message = post_message(db, team.id, user.id, content, kind=kind, metadata=metadata, reply_to_id=body.reply_to_id)
    db.commit()
    return message_dict(message)


def _own_message(db: Session, message_id: str, user) -> TeamMessage:
    message = _visible_message(db, message_id, user.id)
    authorize(db, user, require_team(db, message.team_id), "write")
    if message.author_user_id != user.id or message.deleted_at is not None:
        raise HTTPException(403, "Only the author can change this message")
    return message


@router.patch("/api/messages/{message_id}")
def edit_message(message_id: str, body: MessageEdit, db: Db, user: CurrentUser) -> dict:
    message = _own_message(db, message_id, user)
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Message is empty")
    message.content = content
    message.edited_at = now()
    payload = _emit_edited(db, message, user.id)
    db.commit()
    return payload


@router.delete("/api/messages/{message_id}")
def delete_message(message_id: str, db: Db, user: CurrentUser) -> dict:
    message = _own_message(db, message_id, user)
    message.deleted_at = now()
    emit(db, message.team_id, "message.deleted", user.id, {"id": message.id}, visible_to_user_id=message.visible_to_user_id)
    db.commit()
    return {"id": message.id, "deleted": True}


@router.post("/api/messages/{message_id}/reactions")
def toggle_reaction(message_id: str, body: ReactionToggle, db: Db, user: CurrentUser) -> dict:
    message = _visible_message(db, message_id, user.id)
    authorize(db, user, require_team(db, message.team_id), "write")
    if message.deleted_at is not None:
        raise HTTPException(409, "This message was deleted")
    existing = db.scalar(select(MessageReaction).where(
        MessageReaction.message_id == message.id, MessageReaction.user_id == user.id, MessageReaction.emoji == body.emoji,
    ))
    if existing is not None:
        db.delete(existing)
    else:
        db.add(MessageReaction(message_id=message.id, user_id=user.id, emoji=body.emoji))
    payload = {"message_id": message.id, "user_id": user.id, "emoji": body.emoji, "on": existing is None}
    emit(db, message.team_id, "reaction.toggled", user.id, payload, visible_to_user_id=message.visible_to_user_id)
    db.commit()
    return payload


@router.post("/api/messages/{message_id}/poll-vote")
def vote_in_poll(message_id: str, body: PollVote, db: Db, user: CurrentUser) -> dict:
    message = _visible_message(db, message_id, user.id)
    authorize(db, user, require_team(db, message.team_id), "write")
    if message.kind != "poll" or message.deleted_at is not None:
        raise HTTPException(409, "This message is not an open poll")
    metadata = loads(message.metadata_json, {})
    if body.option >= len(metadata.get("options", [])):
        raise HTTPException(422, "Unknown poll option")
    metadata.setdefault("votes", {})[user.id] = body.option
    message.metadata_json = json.dumps(metadata, ensure_ascii=False)
    payload = _emit_edited(db, message, user.id)
    db.commit()
    return payload


@router.post("/api/teams/{team_id}/decisions", status_code=201)
def pin_decision(team_id: str, body: DecisionCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    message = _visible_message(db, body.message_id, user.id)
    if message.team_id != team.id or message.visible_to_user_id or message.deleted_at is not None:
        raise HTTPException(422, "Only visible team messages can become decisions")
    decision = Decision(team_id=team.id, text=message.content, source_message_id=message.id, pinned_by=user.id)
    db.add(decision)
    db.flush()
    emit(db, team.id, "decision.pinned", user.id, decision_dict(decision))
    db.commit()
    return decision_dict(decision)


@router.delete("/api/decisions/{decision_id}")
def remove_decision(decision_id: str, db: Db, user: CurrentUser) -> dict:
    decision = require(db, Decision, decision_id, "Decision")
    authorize(db, user, require_team(db, decision.team_id), "write")
    team_id = decision.team_id
    db.delete(decision)
    emit(db, team_id, "decision.removed", user.id, {"id": decision_id})
    db.commit()
    return {"id": decision_id, "removed": True}


@router.post("/api/teams/{team_id}/seen")
def mark_seen(team_id: str, body: SeenUpdate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
    member.last_seen_seq = max(member.last_seen_seq, body.seq)
    db.commit()
    return {"last_seen_seq": member.last_seen_seq}
```

- [ ] **Step 4: Register the router**

In `services/api/app/teams/__init__.py`, add `from .chat import router as chat_router` and `router.include_router(chat_router)`.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_chat.py -v`
Expected: 6 passed. Full suite: 126 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/tests/test_teams_chat.py
git commit -m "feat(teams): add team chat with polls, reactions, pinned decisions and seen pointer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Tasks, dependencies and milestones

**Files:**
- Create: `services/api/app/teams/tasks.py`
- Modify: `services/api/app/teams/__init__.py`
- Create: `services/api/tests/test_teams_tasks.py`

**Interfaces:**
- Consumes: `emit`, `post_message` (Task 5), `authorize`, `require`, `require_team`, `iso`, `loads`, `now`.
- Produces: `task_dict(task) -> dict` (keys `id, team_id, title, description, status, assignee_id, estimate_points, due, depends_on, milestone_id, rubric_refs, rationale, created_by, position, created_at, updated_at`), `milestone_dict(milestone) -> dict` (keys `id, team_id, title, due, deliverable_key, completed_at`), `assert_acyclic(graph: dict[str, list[str]]) -> None` (raises `ValueError`), `TASK_STATUSES`.
- Endpoints: `POST /api/teams/{id}/tasks` (201), `PATCH /api/tasks/{id}`, `POST /api/tasks/{id}/move`, `DELETE /api/tasks/{id}`, `POST /api/teams/{id}/milestones` (201), `PATCH /api/milestones/{id}`.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_tasks.py`:

```python
import json

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import Task
from app.teams.tasks import assert_acyclic


def _task(client, team_id, user_id, **body):
    return client.post(f"/api/teams/{team_id}/tasks", json={"title": "Task", **body}, headers=hdr(user_id))


def test_create_validates_assignee_and_emits_once(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    before = len(events_for(team))
    assert _task(client, team, s0, assignee_id=world["outsider"]).status_code == 422
    assert _task(client, team, world["instructor"]).status_code == 403
    assert len(events_for(team)) == before
    created = _task(client, team, s0, title="Login API", assignee_id=s1, estimate_points=3)
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["status"], body["created_by"], body["estimate_points"]) == ("todo", "user", 3)
    assert [event["type"] for event in events_for(team)[before:]] == ["task.created"]


def test_dependency_cycles_are_rejected(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    first = _task(client, team, s0, title="A").json()
    second = _task(client, team, s0, title="B", depends_on=[first["id"]]).json()
    assert client.patch(f"/api/tasks/{first['id']}", json={"depends_on": [second["id"]]}, headers=hdr(s0)).status_code == 422
    assert client.patch(f"/api/tasks/{first['id']}", json={"depends_on": [first["id"]]}, headers=hdr(s0)).status_code == 422
    assert _task(client, team, s0, depends_on=["no-such-task"]).status_code == 422
    renamed = client.patch(f"/api/tasks/{first['id']}", json={"title": "A, renamed"}, headers=hdr(s0))
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "A, renamed"


def test_assert_acyclic_finds_long_cycles():
    assert_acyclic({"a": ["b"], "b": ["c"], "c": []})
    with pytest.raises(ValueError):
        assert_acyclic({"a": ["b"], "b": ["c"], "c": ["a"]})


def test_finishing_the_last_task_completes_the_milestone(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    milestone = client.post(f"/api/teams/{team}/milestones", json={"title": "SRS submitted", "deliverable_key": "srs"}, headers=hdr(s0))
    assert milestone.status_code == 201, milestone.text
    first = _task(client, team, s0, milestone_id=milestone.json()["id"]).json()
    second = _task(client, team, s0, milestone_id=milestone.json()["id"]).json()
    before = len(events_for(team))
    client.post(f"/api/tasks/{first['id']}/move", json={"status": "done"}, headers=hdr(s0))
    assert [event["type"] for event in events_for(team)[before:]] == ["task.moved"]
    before = len(events_for(team))
    client.post(f"/api/tasks/{second['id']}/move", json={"status": "done"}, headers=hdr(s0))
    new = events_for(team)[before:]
    assert [event["type"] for event in new] == ["task.moved", "milestone.completed", "message.created"]
    assert new[2]["payload"]["kind"] == "system"
    assert "SRS submitted" in new[2]["payload"]["content"]
    client.post(f"/api/tasks/{second['id']}/move", json={"status": "doing"}, headers=hdr(s0))
    reopened = events_for(team)[-1]
    assert reopened["type"] == "milestone.updated"
    assert reopened["payload"]["completed_at"] is None


def test_deleting_a_task_detaches_dependents(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    first = _task(client, team, s0, title="A").json()
    second = _task(client, team, s0, title="B", depends_on=[first["id"]]).json()
    assert client.delete(f"/api/tasks/{first['id']}", headers=hdr(s0)).status_code == 200
    assert events_for(team)[-1]["payload"] == {"id": first["id"], "detached_from": [second["id"]]}
    db = SessionLocal()
    try:
        assert json.loads(db.get(Task, second["id"]).depends_on_json) == []
    finally:
        db.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_tasks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.teams.tasks'`

- [ ] **Step 3: Implement `tasks.py`**

```python
from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .chat import post_message
from .common import Db, iso, loads, require, require_team
from .events import emit
from .models import Milestone, Task, Team, TeamMember
from .policy import authorize

router = APIRouter()
TASK_STATUSES = ("todo", "doing", "review", "done")


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    assignee_id: str | None = None
    estimate_points: int = Field(default=1, ge=1, le=8)
    due: datetime | None = None
    depends_on: list[str] = Field(default_factory=list, max_length=20)
    milestone_id: str | None = None
    rubric_refs: list[str] = Field(default_factory=list, max_length=12)
    rationale: str = Field(default="", max_length=1000)


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assignee_id: str | None = None
    estimate_points: int | None = Field(default=None, ge=1, le=8)
    due: datetime | None = None
    depends_on: list[str] | None = Field(default=None, max_length=20)
    milestone_id: str | None = None
    rubric_refs: list[str] | None = Field(default=None, max_length=12)


class TaskMove(BaseModel):
    status: Literal["todo", "doing", "review", "done"]
    position: float | None = None


class MilestoneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    due: datetime | None = None
    deliverable_key: str | None = Field(default=None, max_length=24)


class MilestonePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    due: datetime | None = None


def task_dict(task: Task) -> dict:
    return {
        "id": task.id, "team_id": task.team_id, "title": task.title, "description": task.description,
        "status": task.status, "assignee_id": task.assignee_id, "estimate_points": task.estimate_points,
        "due": iso(task.due), "depends_on": loads(task.depends_on_json, []), "milestone_id": task.milestone_id,
        "rubric_refs": loads(task.rubric_refs_json, []), "rationale": task.rationale, "created_by": task.created_by,
        "position": task.position, "created_at": iso(task.created_at), "updated_at": iso(task.updated_at),
    }


def milestone_dict(milestone: Milestone) -> dict:
    return {
        "id": milestone.id, "team_id": milestone.team_id, "title": milestone.title, "due": iso(milestone.due),
        "deliverable_key": milestone.deliverable_key, "completed_at": iso(milestone.completed_at),
    }


def assert_acyclic(graph: dict[str, list[str]]) -> None:
    state: dict[str, int] = {}

    def visit(node: str) -> None:
        if state.get(node) == 1:
            raise ValueError("Task dependencies would form a cycle")
        if state.get(node) == 2:
            return
        state[node] = 1
        for dependency in graph.get(node, []):
            visit(dependency)
        state[node] = 2

    for node in graph:
        visit(node)


def _team_tasks(db: Session, team_id: str) -> list[Task]:
    return db.scalars(select(Task).where(Task.team_id == team_id)).all()


def _validate(db: Session, team: Team, *, assignee_id: str | None, milestone_id: str | None, depends_on: list[str], task_id: str | None = None) -> None:
    if assignee_id is not None and not db.scalar(select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == assignee_id)):
        raise HTTPException(422, "The assignee must be a member of this team")
    if milestone_id is not None:
        milestone = db.get(Milestone, milestone_id)
        if milestone is None or milestone.team_id != team.id:
            raise HTTPException(422, "Unknown milestone")
    tasks = _team_tasks(db, team.id)
    if (task_id is not None and task_id in depends_on) or set(depends_on) - {task.id for task in tasks}:
        raise HTTPException(422, "Dependencies must be other tasks in this team")
    graph = {task.id: loads(task.depends_on_json, []) for task in tasks}
    if task_id is not None:
        graph[task_id] = list(depends_on)
    try:
        assert_acyclic(graph)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def _next_position(db: Session, team_id: str, status: str) -> float:
    current = db.scalar(select(func.max(Task.position)).where(Task.team_id == team_id, Task.status == status))
    return (current or 0) + 1


def _sync_milestone(db: Session, team_id: str, milestone_id: str | None, actor: str) -> None:
    if not milestone_id:
        return
    milestone = db.get(Milestone, milestone_id)
    statuses = db.scalars(select(Task.status).where(Task.milestone_id == milestone_id)).all()
    complete = bool(statuses) and all(status == "done" for status in statuses)
    if complete and milestone.completed_at is None:
        milestone.completed_at = now()
        emit(db, team_id, "milestone.completed", actor, milestone_dict(milestone))
        post_message(db, team_id, None, f"Milestone complete: {milestone.title}", kind="system", metadata={"milestone_id": milestone.id})
    elif not complete and milestone.completed_at is not None:
        milestone.completed_at = None
        emit(db, team_id, "milestone.updated", actor, milestone_dict(milestone))


@router.post("/api/teams/{team_id}/tasks", status_code=201)
def create_task(team_id: str, body: TaskCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Give the task a title")
    _validate(db, team, assignee_id=body.assignee_id, milestone_id=body.milestone_id, depends_on=body.depends_on)
    task = Task(
        team_id=team.id, title=title, description=body.description, assignee_id=body.assignee_id,
        estimate_points=body.estimate_points, due=body.due, depends_on_json=json.dumps(body.depends_on),
        milestone_id=body.milestone_id, rubric_refs_json=json.dumps(body.rubric_refs), rationale=body.rationale,
        created_by="user", position=_next_position(db, team.id, "todo"),
    )
    db.add(task)
    db.flush()
    emit(db, team.id, "task.created", user.id, task_dict(task))
    db.commit()
    return task_dict(task)


@router.patch("/api/tasks/{task_id}")
def update_task(task_id: str, body: TaskPatch, db: Db, user: CurrentUser) -> dict:
    task = require(db, Task, task_id, "Task")
    team = require_team(db, task.team_id)
    authorize(db, user, team, "write")
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(422, "Nothing to update")
    assignee = body.assignee_id if "assignee_id" in fields else task.assignee_id
    milestone = body.milestone_id if "milestone_id" in fields else task.milestone_id
    depends_on = body.depends_on if body.depends_on is not None else loads(task.depends_on_json, [])
    _validate(db, team, assignee_id=assignee, milestone_id=milestone, depends_on=depends_on, task_id=task.id)
    previous_milestone = task.milestone_id
    if body.title is not None:
        task.title = body.title.strip() or task.title
    if body.description is not None:
        task.description = body.description
    if body.estimate_points is not None:
        task.estimate_points = body.estimate_points
    if body.rubric_refs is not None:
        task.rubric_refs_json = json.dumps(body.rubric_refs)
    if "due" in fields:
        task.due = body.due
    task.assignee_id = assignee
    task.milestone_id = milestone
    task.depends_on_json = json.dumps(depends_on)
    task.updated_at = now()
    db.flush()
    emit(db, team.id, "task.updated", user.id, task_dict(task))
    if previous_milestone != milestone:
        _sync_milestone(db, team.id, previous_milestone, user.id)
        _sync_milestone(db, team.id, milestone, user.id)
    db.commit()
    return task_dict(task)


@router.post("/api/tasks/{task_id}/move")
def move_task(task_id: str, body: TaskMove, db: Db, user: CurrentUser) -> dict:
    task = require(db, Task, task_id, "Task")
    team = require_team(db, task.team_id)
    authorize(db, user, team, "write")
    previous = task.status
    position = body.position if body.position is not None else _next_position(db, team.id, body.status)
    task.status = body.status
    task.position = position
    task.updated_at = now()
    db.flush()
    emit(db, team.id, "task.moved", user.id, {"id": task.id, "status": task.status, "position": task.position, "from": previous})
    _sync_milestone(db, team.id, task.milestone_id, user.id)
    db.commit()
    return task_dict(task)


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, db: Db, user: CurrentUser) -> dict:
    task = require(db, Task, task_id, "Task")
    team = require_team(db, task.team_id)
    authorize(db, user, team, "write")
    detached = []
    for other in _team_tasks(db, team.id):
        dependencies = loads(other.depends_on_json, [])
        if task.id in dependencies:
            other.depends_on_json = json.dumps([item for item in dependencies if item != task.id])
            detached.append(other.id)
    milestone_id = task.milestone_id
    db.delete(task)
    db.flush()
    emit(db, team.id, "task.deleted", user.id, {"id": task_id, "detached_from": detached})
    _sync_milestone(db, team.id, milestone_id, user.id)
    db.commit()
    return {"id": task_id, "deleted": True}


@router.post("/api/teams/{team_id}/milestones", status_code=201)
def create_milestone(team_id: str, body: MilestoneCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    milestone = Milestone(team_id=team.id, title=body.title.strip(), due=body.due, deliverable_key=body.deliverable_key)
    db.add(milestone)
    db.flush()
    emit(db, team.id, "milestone.created", user.id, milestone_dict(milestone))
    db.commit()
    return milestone_dict(milestone)


@router.patch("/api/milestones/{milestone_id}")
def update_milestone(milestone_id: str, body: MilestonePatch, db: Db, user: CurrentUser) -> dict:
    milestone = require(db, Milestone, milestone_id, "Milestone")
    authorize(db, user, require_team(db, milestone.team_id), "write")
    if body.title is not None:
        milestone.title = body.title.strip() or milestone.title
    if "due" in body.model_fields_set:
        milestone.due = body.due
    emit(db, milestone.team_id, "milestone.updated", user.id, milestone_dict(milestone))
    db.commit()
    return milestone_dict(milestone)
```

- [ ] **Step 4: Register the router**

In `services/api/app/teams/__init__.py`, add `from .tasks import router as tasks_router` and `router.include_router(tasks_router)`.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_tasks.py -v`
Expected: 5 passed. Full suite: 131 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/tests/test_teams_tasks.py
git commit -m "feat(teams): add tasks with dependency DAG, moves and milestone completion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Documents, IEEE outlines and section locks

**Files:**
- Create: `services/api/app/teams/docs.py`
- Modify: `services/api/app/teams/__init__.py`
- Create: `services/api/tests/test_teams_docs.py`

**Interfaces:**
- Consumes: `emit`, `authorize`, `aware`, `iso`, `loads`, `require`, `require_team`, `now`.
- Produces: `OUTLINES: dict[str, tuple[str, list[tuple[str, str]]]]`, `LOCK_SECONDS = 90`, `section_dict(section) -> dict` (keys `id, document_id, key, title, position, owner_user_id, content_md, status, lock_user_id, lock_expires_at, version, meta`), `document_dict(document, sections) -> dict` (keys `id, team_id, kind, title, created_at, sections`), `lock_active(section, at) -> bool`.
- Endpoints: `POST /api/teams/{id}/documents` (201), `PATCH /api/sections/{id}`, `POST /api/sections/{id}/lock`, `POST /api/sections/{id}/unlock`, `PUT /api/sections/{id}/content`.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_docs.py`:

```python
from datetime import datetime, timedelta

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import DocSection


def _srs(client, world):
    response = client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "srs"}, headers=hdr(world["students"][0]))
    assert response.status_code == 201, response.text
    return response.json()


def _section(document, key):
    return next(section for section in document["sections"] if section["key"] == key)


def test_srs_document_gets_the_ieee_outline(client):
    world = make_world()
    document = _srs(client, world)
    assert document["title"] == "Software Requirements Specification"
    keys = [section["key"] for section in document["sections"]]
    assert keys[:3] == ["1", "1.1", "1.2"]
    assert "3.2" in keys
    assert {section["status"] for section in document["sections"]} == {"empty"}
    custom = client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "custom"}, headers=hdr(world["students"][0]))
    assert custom.status_code == 422


def test_section_lock_and_versioned_save(client):
    world = make_world()
    s0, s1 = world["students"][:2]
    section = _section(_srs(client, world), "3.2")
    base = f"/api/sections/{section['id']}"
    assert client.post(f"{base}/lock", headers=hdr(s0)).json()["lock_user_id"] == s0
    client.post(f"{base}/lock", headers=hdr(s0))
    assert [event["type"] for event in events_for(world["team_id"])].count("section.locked") == 1
    assert client.post(f"{base}/lock", headers=hdr(s1)).status_code == 409
    assert client.put(f"{base}/content", json={"content_md": "Mine", "version": 0}, headers=hdr(s1)).status_code == 409
    saved = client.put(f"{base}/content", json={"content_md": "FR-1 The system shall list found items.", "version": 0}, headers=hdr(s0))
    assert saved.status_code == 200, saved.text
    assert (saved.json()["version"], saved.json()["status"]) == (1, "accepted")
    assert client.put(f"{base}/content", json={"content_md": "Stale", "version": 0}, headers=hdr(s0)).status_code == 409
    assert client.post(f"{base}/unlock", headers=hdr(s1)).status_code == 403
    assert client.post(f"{base}/unlock", headers=hdr(s0)).status_code == 200
    assert client.post(f"{base}/lock", headers=hdr(s1)).status_code == 200


def test_expired_lock_can_be_taken_over(client):
    world = make_world()
    s0, s1 = world["students"][:2]
    section = _section(_srs(client, world), "1.1")
    client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s0))
    db = SessionLocal()
    try:
        # Naive, as SQLite returns it.
        db.get(DocSection, section["id"]).lock_expires_at = datetime.utcnow() - timedelta(minutes=5)
        db.commit()
    finally:
        db.close()
    taken = client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s1))
    assert taken.status_code == 200, taken.text
    assert taken.json()["lock_user_id"] == s1


def test_section_owner_must_be_a_member(client):
    world = make_world()
    section = _section(_srs(client, world), "2.1")
    url = f"/api/sections/{section['id']}"
    assert client.patch(url, json={"owner_user_id": world["outsider"]}, headers=hdr(world["students"][0])).status_code == 422
    owned = client.patch(url, json={"owner_user_id": world["students"][1]}, headers=hdr(world["students"][0]))
    assert owned.json()["owner_user_id"] == world["students"][1]
    assert events_for(world["team_id"])[-1]["type"] == "section.updated"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_docs.py -v`
Expected: FAIL with 404 responses (the routes don't exist yet).

- [ ] **Step 3: Implement `docs.py`**

```python
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .common import Db, aware, iso, loads, require, require_team
from .events import emit
from .models import DocSection, Team, TeamDocument, TeamMember
from .policy import authorize

router = APIRouter()
LOCK_SECONDS = 90

# Section outlines follow IEEE 29148 (SRS), IEEE 1016 (SDS) and IEEE 1058 (SPMP).
OUTLINES: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "srs": ("Software Requirements Specification", [
        ("1", "Introduction"), ("1.1", "Purpose"), ("1.2", "Scope"), ("1.3", "Definitions and acronyms"),
        ("2", "Overall description"), ("2.1", "Product perspective"), ("2.2", "User classes and characteristics"),
        ("2.3", "Constraints and assumptions"), ("3", "Requirements"), ("3.1", "External interfaces"),
        ("3.2", "Functional requirements"), ("3.3", "Non-functional requirements"), ("4", "Verification"),
    ]),
    "sds": ("Software Design Specification", [
        ("1", "Introduction"), ("2", "Design stakeholders and concerns"), ("3", "Architecture view"),
        ("4", "Data design"), ("5", "Component design"), ("6", "Interface design"), ("7", "Requirements traceability"),
    ]),
    "spmp": ("Software Project Management Plan", [
        ("1", "Overview"), ("2", "Project organization"), ("3", "Managerial process"), ("3.1", "Estimates"),
        ("3.2", "Schedule"), ("3.3", "Risk management"), ("4", "Technical process"), ("5", "Supporting processes"),
    ]),
}


class SectionSpec(BaseModel):
    key: str = Field(min_length=1, max_length=16)
    title: str = Field(min_length=1, max_length=160)


class DocumentCreate(BaseModel):
    kind: Literal["srs", "sds", "spmp", "custom"]
    title: str | None = Field(default=None, max_length=160)
    sections: list[SectionSpec] | None = Field(default=None, max_length=60)


class SectionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    owner_user_id: str | None = None


class SectionContent(BaseModel):
    content_md: str = Field(max_length=60000)
    version: int = Field(ge=0)


def section_dict(section: DocSection) -> dict:
    return {
        "id": section.id, "document_id": section.document_id, "key": section.key, "title": section.title,
        "position": section.position, "owner_user_id": section.owner_user_id, "content_md": section.content_md,
        "status": section.status, "lock_user_id": section.lock_user_id, "lock_expires_at": iso(section.lock_expires_at),
        "version": section.version, "meta": loads(section.meta_json, {}),
    }


def document_dict(document: TeamDocument, sections: list[DocSection]) -> dict:
    return {
        "id": document.id, "team_id": document.team_id, "kind": document.kind, "title": document.title,
        "created_at": iso(document.created_at), "sections": [section_dict(section) for section in sections],
    }


def lock_active(section: DocSection, at: datetime) -> bool:
    return section.lock_user_id is not None and section.lock_expires_at is not None and aware(section.lock_expires_at) > at


def _section_and_team(db: Session, section_id: str) -> tuple[DocSection, Team]:
    section = require(db, DocSection, section_id, "Section")
    document = db.get(TeamDocument, section.document_id)
    return section, require_team(db, document.team_id)


@router.post("/api/teams/{team_id}/documents", status_code=201)
def create_document(team_id: str, body: DocumentCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    if body.sections:
        specs = [(item.key.strip(), item.title.strip()) for item in body.sections]
    elif body.kind in OUTLINES:
        specs = OUTLINES[body.kind][1]
    else:
        raise HTTPException(422, "A custom document needs at least one section")
    if len({key for key, _ in specs}) != len(specs):
        raise HTTPException(422, "Section keys must be unique")
    default_title = OUTLINES[body.kind][0] if body.kind in OUTLINES else "Document"
    document = TeamDocument(team_id=team.id, kind=body.kind, title=(body.title or "").strip() or default_title)
    db.add(document)
    db.flush()
    sections = [DocSection(document_id=document.id, key=key, title=title, position=index) for index, (key, title) in enumerate(specs)]
    db.add_all(sections)
    db.flush()
    payload = document_dict(document, sections)
    emit(db, team.id, "document.created", user.id, payload)
    db.commit()
    return payload


@router.patch("/api/sections/{section_id}")
def update_section(section_id: str, body: SectionPatch, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    if "owner_user_id" in body.model_fields_set:
        if body.owner_user_id is not None and not db.scalar(
            select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == body.owner_user_id)
        ):
            raise HTTPException(422, "The owner must be a member of this team")
        section.owner_user_id = body.owner_user_id
    if body.title is not None:
        section.title = body.title.strip() or section.title
    emit(db, team.id, "section.updated", user.id, section_dict(section))
    db.commit()
    return section_dict(section)


@router.post("/api/sections/{section_id}/lock")
def lock_section(section_id: str, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    at = now()
    active = lock_active(section, at)
    if active and section.lock_user_id != user.id:
        raise HTTPException(409, "Someone else is editing this section")
    section.lock_user_id = user.id
    section.lock_expires_at = at + timedelta(seconds=LOCK_SECONDS)
    if not active:
        # Re-locking your own live lock is a heartbeat and emits nothing.
        emit(db, team.id, "section.locked", user.id, {"id": section.id, "lock_user_id": user.id, "lock_expires_at": iso(section.lock_expires_at)})
    db.commit()
    return section_dict(section)


@router.post("/api/sections/{section_id}/unlock")
def unlock_section(section_id: str, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    if not lock_active(section, now()):
        return section_dict(section)
    if section.lock_user_id != user.id:
        raise HTTPException(403, "Only the person editing can release this lock")
    section.lock_user_id = None
    section.lock_expires_at = None
    emit(db, team.id, "section.unlocked", user.id, {"id": section.id})
    db.commit()
    return section_dict(section)


@router.put("/api/sections/{section_id}/content")
def save_section(section_id: str, body: SectionContent, db: Db, user: CurrentUser) -> dict:
    section, team = _section_and_team(db, section_id)
    authorize(db, user, team, "write")
    at = now()
    if not (lock_active(section, at) and section.lock_user_id == user.id):
        raise HTTPException(409, "Open the section for editing first")
    if body.version != section.version:
        raise HTTPException(409, "Someone saved a newer version; reload the section")
    section.content_md = body.content_md
    section.version += 1
    section.status = "accepted" if body.content_md.strip() else "empty"
    section.lock_expires_at = at + timedelta(seconds=LOCK_SECONDS)
    emit(db, team.id, "section.updated", user.id, section_dict(section))
    db.commit()
    return section_dict(section)
```

- [ ] **Step 4: Register the router**

In `services/api/app/teams/__init__.py`, add `from .docs import router as docs_router` and `router.include_router(docs_router)`.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_docs.py -v`
Expected: 4 passed. Full suite: 135 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/tests/test_teams_docs.py
git commit -m "feat(teams): add SRS/SDS/SPMP documents with section owners, locks and versioned saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Presence and typing

**Files:**
- Create: `services/api/app/teams/presence.py`
- Modify: `services/api/app/teams/events.py` (the stream loop)
- Modify: `services/api/app/teams/__init__.py`
- Create: `services/api/tests/test_teams_presence.py`

**Interfaces:**
- Consumes: `authorize`, `is_member`, `require_team`, the stream in `events.py`.
- Produces: `touch(team_id, user_id, *, focus=None, typing=False) -> None`, `snapshot(team_id, *, include_typing=True) -> list[dict]` (keys `user_id, focus, typing`), `presence_frame(team_id, include_typing) -> str`, module `_clock`, `TTL_SECONDS = 30`, `TYPING_SECONDS = 5`; `events.PRESENCE_SECONDS = 2`.
- Endpoints: `POST /api/teams/{id}/presence` `{focus}`, `POST /api/teams/{id}/typing`.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_presence.py`:

```python
import json
import re

import pytest

from team_world import client, hdr, make_world  # noqa: F401

from app.teams import events, presence


@pytest.fixture(autouse=True)
def one_poll(monkeypatch):
    monkeypatch.setattr(events, "MAX_POLLS", 1)
    monkeypatch.setattr(events, "POLL_SECONDS", 0)


def _presence(text: str) -> list[dict]:
    match = re.search(r"^event: presence\ndata: (.+)$", text, re.M)
    assert match, text
    return json.loads(match.group(1))


def test_stream_reports_online_members_and_typing(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    assert client.post(f"/api/teams/{team}/presence", json={"focus": "task:abc"}, headers=hdr(s1)).status_code == 200
    assert client.post(f"/api/teams/{team}/typing", headers=hdr(s1)).status_code == 200
    frame = {entry["user_id"]: entry for entry in _presence(client.get(f"/api/teams/{team}/events", params={"as": s0}).text)}
    assert frame[s1] == {"user_id": s1, "focus": "task:abc", "typing": True}
    assert s0 in frame  # an open stream counts as being online


def test_instructors_get_presence_without_typing_and_are_not_listed(client):
    world = make_world()
    team, s1 = world["team_id"], world["students"][1]
    client.post(f"/api/teams/{team}/typing", headers=hdr(s1))
    frame = {entry["user_id"]: entry for entry in _presence(client.get(f"/api/teams/{team}/events", params={"as": world["instructor"]}).text)}
    assert frame[s1]["typing"] is False
    assert world["instructor"] not in frame
    assert client.post(f"/api/teams/{team}/typing", headers=hdr(world["instructor"])).status_code == 403


def test_presence_expires(client, monkeypatch):
    world = make_world()
    team, s1 = world["team_id"], world["students"][1]
    client.post(f"/api/teams/{team}/presence", json={"focus": None}, headers=hdr(s1))
    base = presence._clock()
    monkeypatch.setattr(presence, "_clock", lambda: base + presence.TTL_SECONDS + 1)
    assert presence.snapshot(team) == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_presence.py -v`
Expected: FAIL with `ImportError: cannot import name 'presence' from 'app.teams'`

- [ ] **Step 3: Implement `presence.py`**

```python
from __future__ import annotations

import json
import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..identity import CurrentUser
from .common import Db, require_team
from .policy import authorize

# Ephemeral: lost on restart by design (spec §6). Never written to SQLite.
TTL_SECONDS = 30
TYPING_SECONDS = 5
_clock = time.monotonic
_state: dict[str, dict[str, dict]] = {}

router = APIRouter()


class PresenceUpdate(BaseModel):
    focus: str | None = Field(default=None, max_length=80)


def touch(team_id: str, user_id: str, *, focus: str | None = None, typing: bool = False) -> None:
    at = _clock()
    entry = _state.setdefault(team_id, {}).setdefault(user_id, {"focus": None, "typing_until": 0.0, "seen": at})
    entry["seen"] = at
    if focus is not None:
        entry["focus"] = focus or None
    if typing:
        entry["typing_until"] = at + TYPING_SECONDS


def snapshot(team_id: str, *, include_typing: bool = True) -> list[dict]:
    at = _clock()
    team = _state.get(team_id, {})
    for user_id in [user_id for user_id, entry in team.items() if at - entry["seen"] > TTL_SECONDS]:
        del team[user_id]
    return [
        {"user_id": user_id, "focus": entry["focus"], "typing": include_typing and entry["typing_until"] > at}
        for user_id, entry in sorted(team.items())
    ]


def presence_frame(team_id: str, include_typing: bool) -> str:
    return f"event: presence\ndata: {json.dumps(snapshot(team_id, include_typing=include_typing))}\n\n"


@router.post("/api/teams/{team_id}/presence")
def update_presence(team_id: str, body: PresenceUpdate, db: Db, user: CurrentUser) -> dict:
    authorize(db, user, require_team(db, team_id), "write")
    touch(team_id, user.id, focus=body.focus if body.focus is not None else "")
    return {"ok": True}


@router.post("/api/teams/{team_id}/typing")
def update_typing(team_id: str, db: Db, user: CurrentUser) -> dict:
    authorize(db, user, require_team(db, team_id), "write")
    touch(team_id, user.id, typing=True)
    return {"ok": True}
```

- [ ] **Step 4: Send presence frames from the stream**

In `services/api/app/teams/events.py`:

- Add the import `from .presence import presence_frame, touch` and change the policy import to `from .policy import authorize, is_member`.
- Add the constant `PRESENCE_SECONDS = 2` below `HEARTBEAT_SECONDS`.
- Replace the `stream()` generator with:

```python
    def stream():
        cursor, polls, last_beat, last_presence = start, 0, time.monotonic(), 0.0
        yield "retry: 2000\n\n"
        while True:
            session = SessionLocal()
            try:
                rows, cursor = events_after(session, team_id, cursor, user_id, role)
                frames = [sse_frame(row) for row in rows]
            finally:
                session.close()
            yield from frames
            if is_member(role):
                touch(team_id, user_id)  # an open stream means this member is online
            if time.monotonic() - last_presence >= PRESENCE_SECONDS:
                yield presence_frame(team_id, include_typing=role != "instructor")
                last_presence = time.monotonic()
            if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                yield ": keep-alive\n\n"
                last_beat = time.monotonic()
            polls += 1
            if MAX_POLLS is not None and polls >= MAX_POLLS:
                return
            time.sleep(POLL_SECONDS)
```

Register the router in `services/api/app/teams/__init__.py`: add `from .presence import router as presence_router` and `router.include_router(presence_router)`.

> Note: `touch(team_id, user.id, focus="")` in `update_presence` clears the focus when the body sends `null`. `touch()` stores `""` as `None`.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_presence.py services/api/tests/test_teams_events.py -v`
Expected: 7 passed. The event tests still pass because presence frames carry no `id:` line. Full suite: 138 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/tests/test_teams_presence.py
git commit -m "feat(teams): add in-memory presence and typing frames to the team stream

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Workspace state snapshot and contribution summary

**Files:**
- Create: `services/api/app/teams/state.py`
- Modify: `services/api/app/teams/__init__.py`
- Create: `services/api/tests/test_teams_state.py`

**Interfaces:**
- Consumes: `team_dict` (Task 4), `message_dict`, `reactions_for`, `decision_dict` (Task 5), `task_dict`, `milestone_dict` (Task 6), `document_dict` (Task 7), `authorize`, `is_member`.
- Produces: `GET /api/teams/{id}/state` returning `{team, tasks, milestones, decisions, documents, messages (list | None for instructors), last_seq, last_seen_seq}`. `last_seq` is read **before** the rows, so a client that streams from `after=last_seq` can't miss a change, though it may receive one it already has (the Plan 3 reducer upserts by id). Also `GET /api/teams/{id}/contribution` returning `{members: [{user_id, display_name, done_points, done_tasks, open_points, messages}]}`, where `messages` is `None` for instructors.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_state.py`:

```python
from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.chat import post_message


def _seed_workspace(client, world):
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    done = client.post(f"/api/teams/{team}/tasks", json={"title": "Interviews", "assignee_id": s1, "estimate_points": 3}, headers=hdr(s0)).json()
    client.post(f"/api/tasks/{done['id']}/move", json={"status": "done"}, headers=hdr(s0))
    client.post(f"/api/teams/{team}/tasks", json={"title": "ERD", "assignee_id": s1, "estimate_points": 2}, headers=hdr(s0))
    client.post(f"/api/teams/{team}/messages", json={"content": "Hello team"}, headers=hdr(s1))
    client.post(f"/api/teams/{team}/documents", json={"kind": "srs"}, headers=hdr(s0))
    db = SessionLocal()
    try:
        post_message(db, team, None, "Only for s1", kind="notice", visible_to_user_id=s1)
        db.commit()
    finally:
        db.close()


def test_member_state_includes_everything_and_last_seq(client):
    world = make_world()
    _seed_workspace(client, world)
    s0, s1 = world["students"][:2]
    state = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(s0)).json()
    assert len(state["tasks"]) == 2
    assert [message["content"] for message in state["messages"]] == ["Hello team"]
    assert state["documents"][0]["kind"] == "srs"
    assert state["last_seq"] == events_for(world["team_id"])[-1]["seq"]
    assert state["last_seen_seq"] == 0
    mine = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(s1)).json()
    assert [message["content"] for message in mine["messages"]] == ["Hello team", "Only for s1"]


def test_instructor_state_has_no_messages(client):
    world = make_world()
    _seed_workspace(client, world)
    state = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(world["instructor"])).json()
    assert state["messages"] is None
    assert state["last_seen_seq"] is None
    assert len(state["tasks"]) == 2
    assert client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(world["outsider"])).status_code == 403


def test_contribution_counts_points_and_hides_chat_from_instructors(client):
    world = make_world()
    _seed_workspace(client, world)
    s1 = world["students"][1]
    members = client.get(f"/api/teams/{world['team_id']}/contribution", headers=hdr(world["students"][0])).json()["members"]
    row = next(item for item in members if item["user_id"] == s1)
    assert (row["done_points"], row["done_tasks"], row["open_points"], row["messages"]) == (3, 1, 2, 1)
    instructor = client.get(f"/api/teams/{world['team_id']}/contribution", headers=hdr(world["instructor"])).json()["members"]
    assert all(item["messages"] is None for item in instructor)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_state.py -v`
Expected: FAIL with 404 responses (the routes don't exist yet).

- [ ] **Step 3: Implement `state.py`**

```python
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import func, select

from ..identity import CurrentUser, User
from .chat import decision_dict, message_dict, reactions_for
from .common import Db, require_team
from .docs import document_dict
from .models import Decision, DocSection, Milestone, Task, TeamDocument, TeamEvent, TeamMember, TeamMessage
from .policy import authorize, is_member
from .tasks import milestone_dict, task_dict
from .teams import team_dict

router = APIRouter()
MESSAGE_WINDOW = 200


@router.get("/api/teams/{team_id}/state")
def team_state(team_id: str, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    # Read the cursor first: anything written after this point arrives on the stream.
    last_seq = db.scalar(select(func.max(TeamEvent.seq)).where(TeamEvent.team_id == team.id)) or 0
    tasks = db.scalars(select(Task).where(Task.team_id == team.id).order_by(Task.status, Task.position)).all()
    milestones = db.scalars(
        select(Milestone).where(Milestone.team_id == team.id).order_by(Milestone.due.is_(None), Milestone.due, Milestone.created_at)
    ).all()
    decisions = db.scalars(select(Decision).where(Decision.team_id == team.id).order_by(Decision.created_at.desc())).all()
    documents = []
    for document in db.scalars(select(TeamDocument).where(TeamDocument.team_id == team.id).order_by(TeamDocument.created_at)).all():
        sections = db.scalars(select(DocSection).where(DocSection.document_id == document.id).order_by(DocSection.position)).all()
        documents.append(document_dict(document, sections))
    messages, last_seen = None, None
    if is_member(role):
        rows = db.scalars(
            select(TeamMessage).where(
                TeamMessage.team_id == team.id,
                (TeamMessage.visible_to_user_id.is_(None)) | (TeamMessage.visible_to_user_id == user.id),
            ).order_by(TeamMessage.created_at.desc()).limit(MESSAGE_WINDOW)
        ).all()[::-1]
        reactions = reactions_for(db, [row.id for row in rows])
        messages = [message_dict(row, reactions.get(row.id)) for row in rows]
        last_seen = db.scalar(select(TeamMember.last_seen_seq).where(TeamMember.team_id == team.id, TeamMember.user_id == user.id))
    return {
        "team": team_dict(db, team, role), "tasks": [task_dict(item) for item in tasks],
        "milestones": [milestone_dict(item) for item in milestones], "decisions": [decision_dict(item) for item in decisions],
        "documents": documents, "messages": messages, "last_seq": last_seq, "last_seen_seq": last_seen,
    }


@router.get("/api/teams/{team_id}/contribution")
def team_contribution(team_id: str, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    role = authorize(db, user, team, "view")
    rows = []
    for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team.id).order_by(TeamMember.joined_at)).all():
        tasks = db.scalars(select(Task).where(Task.team_id == team.id, Task.assignee_id == member.user_id)).all()
        done = [task for task in tasks if task.status == "done"]
        messages = None
        if is_member(role):
            messages = db.scalar(select(func.count()).select_from(TeamMessage).where(
                TeamMessage.team_id == team.id, TeamMessage.author_user_id == member.user_id,
                TeamMessage.deleted_at.is_(None), TeamMessage.visible_to_user_id.is_(None),
            ))
        person = db.get(User, member.user_id)
        rows.append({
            "user_id": member.user_id, "display_name": person.display_name if person else member.user_id,
            "done_points": sum(task.estimate_points for task in done), "done_tasks": len(done),
            "open_points": sum(task.estimate_points for task in tasks if task.status != "done"), "messages": messages,
        })
    return {"members": rows}
```

- [ ] **Step 4: Register the router**

In `services/api/app/teams/__init__.py`, add `from .state import router as state_router` and `router.include_router(state_router)`.

- [ ] **Step 5: Run the tests**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_state.py -v`
Expected: 3 passed. Full suite: 141 passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/teams services/api/tests/test_teams_state.py
git commit -m "feat(teams): add workspace state snapshot and contribution summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Team Falcon demo seed, startup wiring and invariants

**Files:**
- Create: `services/api/app/teams/seed.py`
- Modify: `services/api/app/main.py` (the `startup()` handler near line 176)
- Modify: `AGENTS.md` (the Invariants list)
- Create: `services/api/tests/test_teams_seed.py`

**Interfaces:**
- Consumes: every serializer above, `emit`, `OUTLINES`, `ProjectBrief` (for the test), the existing `Student`, `StudentProfile`, `StudentFact`.
- Produces: `seed_teams(db) -> None` (idempotent; no-op once `team-falcon` exists). Fixed ids: users `demo-student`, `demo-sara`, `demo-ali`, `demo-noura`, `demo-omar`, `demo-reem`, `demo-faisal`, `demo-lama`, `demo-instructor`; courses `course-swe363`, `course-cs485`; assignments `asg-swe363-term`, `asg-cs485-project`; team `team-falcon`; document `doc-falcon-srs`.

- [ ] **Step 1: Write the failing tests**

`services/api/tests/test_teams_seed.py`:

```python
import json

from sqlalchemy import func, select

from team_world import client, hdr  # noqa: F401

from app.database import SessionLocal
from app.schemas import ProjectBrief
from app.teams.models import Assignment, Team, TeamMessage
from app.teams.seed import seed_teams


def test_seed_creates_the_falcon_demo(client):
    home = client.get("/api/me/teams-home", headers=hdr("demo-student")).json()
    falcon = next(card for card in home["teams"] if card["id"] == "team-falcon")
    assert falcon["viewer_role"] == "lead"
    assert falcon["progress"] == 21
    assert falcon["unread"] == 3
    assert "asg-cs485-project" in [item["assignment_id"] for item in home["needs_team"]]
    state = client.get("/api/teams/team-falcon/state", headers=hdr("demo-student")).json()
    assert len(state["tasks"]) == 6
    assert {task["status"] for task in state["tasks"]} == {"todo", "doing", "done"}
    assert len(state["messages"]) == 16
    assert state["documents"][0]["kind"] == "srs"
    assert sum(section["status"] == "accepted" for section in state["documents"][0]["sections"]) == 2
    assert len(state["decisions"]) == 1
    instructor = client.get("/api/teams/team-falcon/state", headers=hdr("demo-instructor")).json()
    assert instructor["messages"] is None


def test_seed_is_idempotent(client):
    db = SessionLocal()
    try:
        before = db.scalar(select(func.count()).select_from(TeamMessage))
        seed_teams(db)
        seed_teams(db)
        assert db.scalar(select(func.count()).select_from(Team).where(Team.id == "team-falcon")) == 1
        assert db.scalar(select(func.count()).select_from(TeamMessage)) == before
    finally:
        db.close()


def test_seed_brief_is_a_valid_project_brief(client):
    db = SessionLocal()
    try:
        for assignment_id in ("asg-swe363-term", "asg-cs485-project"):
            ProjectBrief.model_validate(json.loads(db.get(Assignment, assignment_id).brief_json))
    finally:
        db.close()


def test_demo_users_include_the_instructor_switch_target(client):
    ids = {user["id"] for user in client.get("/api/demo/users").json()}
    assert {"demo-student", "demo-sara", "demo-instructor"} <= ids
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/Scripts/python -m pytest services/api/tests/test_teams_seed.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.teams.seed'`

- [ ] **Step 3: Implement `seed.py`**

```python
"""Idempotent demo world for Group Projects: two courses, eight students, one
instructor and Team Falcon halfway through SWE 363 (spec §11)."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..identity import User
from ..models import Student, StudentFact, StudentProfile
from .chat import decision_dict, message_dict
from .docs import OUTLINES, document_dict, section_dict
from .events import emit
from .models import (
    Assignment, Course, CourseEnrollment, Decision, DocSection, Milestone, Task, Team, TeamDocument, TeamMember, TeamMessage,
)
from .tasks import milestone_dict, task_dict

INSTRUCTOR_ID = "demo-instructor"
UTC = timezone.utc

# id: (name, program, year, {fact category: [values]}). demo-student already
# exists (created at startup) and keeps whatever profile it has.
STUDENTS: dict[str, tuple[str, str, str, dict[str, list[str]]]] = {
    "demo-student": ("Demo Student", "Software Engineering", "Year 3", {}),
    "demo-sara": ("Sara Alharbi", "Software Engineering", "Year 3", {"skill": ["Python", "Computer vision"], "goal": ["Become an ML engineer"]}),
    "demo-ali": ("Ali Alqahtani", "Software Engineering", "Year 3", {"skill": ["Node.js", "REST APIs"], "goal": ["Backend internship next summer"]}),
    "demo-noura": ("Noura Alshehri", "Software Engineering", "Year 3", {"skill": ["Figma", "React"], "goal": ["Product design career"]}),
    "demo-omar": ("Omar Alzahrani", "Computer Science", "Year 4", {"skill": ["PyTorch", "Data analysis"], "goal": ["Graduate research in NLP"]}),
    "demo-reem": ("Reem Aldossari", "Computer Science", "Year 3", {"skill": ["SQL", "Data pipelines"], "goal": ["Data engineering"]}),
    "demo-faisal": ("Faisal Alotaibi", "Software Engineering", "Year 3", {"skill": ["Java", "Testing"], "goal": ["QA automation"]}),
    "demo-lama": ("Lama Alghamdi", "Computer Science", "Year 4", {"skill": ["Kotlin", "Android"], "goal": ["Start a mobile startup"]}),
}
SWE_STUDENTS = ["demo-student", "demo-sara", "demo-ali", "demo-noura", "demo-omar", "demo-reem", "demo-faisal", "demo-lama"]
ML_STUDENTS = ["demo-student", "demo-sara", "demo-omar", "demo-reem", "demo-lama"]
FALCON = ["demo-student", "demo-sara", "demo-ali", "demo-noura"]

SWE_BRIEF = {
    "title": "Campus web application",
    "problem": "Pick one real problem students face on campus and solve it end to end with a web application.",
    "objective": "Deliver a working, documented web application built as a team using a disciplined software process.",
    "deliverables": ["Software Requirements Specification (SRS)", "Software Design Specification (SDS)", "Software Project Management Plan (SPMP)", "Working application and final demo"],
    "milestones": ["SRS by week 7", "SDS by week 10", "Final demo in week 15"],
    "constraints": ["Teams of 3 to 4", "Use Git with pull requests"],
    "tools": ["Git", "Any web stack"],
    "resources": [],
    "rubric": [
        {"id": "requirements", "title": "Requirements quality", "description": "Complete, testable, traceable requirements in the SRS.", "weight": 25},
        {"id": "design", "title": "Design", "description": "Architecture and design decisions justified in the SDS.", "weight": 25},
        {"id": "implementation", "title": "Implementation", "description": "Working features that satisfy the requirements.", "weight": 30},
        {"id": "process", "title": "Process and teamwork", "description": "Plan followed, work shared fairly, decisions recorded.", "weight": 20},
    ],
}
ML_BRIEF = {
    "title": "Applied machine learning project",
    "problem": "Choose a dataset with a real-world question and build a model that answers it responsibly.",
    "objective": "Frame, train, evaluate and explain a model, including its limitations.",
    "deliverables": ["Project proposal", "Final report", "Reproducible notebook or repository"],
    "milestones": ["Proposal by week 6", "Report by week 15"],
    "constraints": ["Teams of 2 to 3", "Document data provenance"],
    "tools": ["Python", "scikit-learn or PyTorch"],
    "resources": [],
    "rubric": [
        {"id": "framing", "title": "Problem framing", "description": "Clear question, suitable data and metrics.", "weight": 25},
        {"id": "method", "title": "Method", "description": "Sound modelling and validation choices.", "weight": 35},
        {"id": "results", "title": "Results and analysis", "description": "Honest evaluation including failure cases.", "weight": 25},
        {"id": "communication", "title": "Communication", "description": "Readable report that explains decisions.", "weight": 15},
    ],
}

FALCON_CHARTER = {
    "goal": "A lost-and-found web app for our campus, live by the final demo.",
    "roles": {"demo-student": "Lead · requirements", "demo-sara": "Research · data", "demo-ali": "Backend", "demo-noura": "UI/UX"},
    "working_agreement": ["Reply in the chat within 24 hours", "Move your card when you start or finish", "Pin every decision"],
    "meetings": "Tuesdays 8pm",
}

# (days ago, author or None for Hermes, text)
FALCON_CHAT: list[tuple[float, str | None, str]] = [
    (9.0, "demo-student", "Hi all! Team Falcon is official 🎉 Lost-and-found app?"),
    (8.9, "demo-sara", "Yes! I lost my calculator twice this term 😅"),
    (8.8, "demo-ali", "I'm in. I can take the backend."),
    (8.7, "demo-noura", "I'll do the UI and wireframes."),
    (8.5, "demo-student", "Stack proposal: React + FastAPI, deployed on Render. Objections?"),
    (8.4, "demo-ali", "Works for me 👍"),
    (8.3, "demo-noura", "Same."),
    (7.0, "demo-sara", "I interviewed 3 students at the library. Notes are in SRS §1.2."),
    (6.8, None, "Nice work, Sara. Across your interviews the most common pain point is not knowing where to hand in found items. That's a strong core requirement for §3.2."),
    (5.0, "demo-ali", "Started the use cases for reporting and claiming an item."),
    (4.2, "demo-noura", "Wireframes for the report screen are halfway done."),
    (3.1, "demo-student", "When can everyone meet this week?"),
    (3.0, "demo-sara", "Tuesday after 8pm works for me"),
    (2.9, "demo-ali", "Tuesday 8pm 👍"),
    (1.2, "demo-noura", "هل نحتاج صفحة للمشرفين في النسخة الأولى؟"),
    (1.1, "demo-sara", "Good question. Let's decide after the use cases are done."),
]
DECISION_INDEX = 4
LAST_SEEN_INDEX = 12  # demo-student has read up to here, so the last 3 are unread

# (id, title, status, assignee, points, milestone, depends_on, created days ago, moved days ago or None)
FALCON_TASKS = [
    ("t-falcon-charter", "Agree on the project charter", "done", "demo-student", 1, None, [], 8.6, 8.2),
    ("t-falcon-interviews", "Interview 3 students about lost items", "done", "demo-sara", 2, "ms-falcon-srs", [], 8.0, 7.0),
    ("t-falcon-usecases", "Draft use cases for reporting and claiming items", "doing", "demo-ali", 3, "ms-falcon-srs", [], 7.9, 5.0),
    ("t-falcon-wireframes", "Wireframe the report and search screens", "doing", "demo-noura", 3, "ms-falcon-srs", [], 7.9, 4.2),
    ("t-falcon-nfr", "List non-functional requirements", "todo", "demo-student", 2, "ms-falcon-srs", ["t-falcon-usecases"], 7.8, None),
    ("t-falcon-erd", "Sketch the data model (ERD)", "todo", "demo-sara", 3, "ms-falcon-sds", ["t-falcon-usecases"], 7.8, None),
]
FALCON_MILESTONES = [
    ("ms-falcon-srs", "SRS submitted", "srs", datetime(2026, 10, 15, tzinfo=UTC)),
    ("ms-falcon-sds", "SDS submitted", "sds", datetime(2026, 11, 5, tzinfo=UTC)),
    ("ms-falcon-demo", "Final demo", None, datetime(2026, 12, 10, tzinfo=UTC)),
]
SECTION_OWNERS = {"1": "demo-student", "1.1": "demo-student", "1.2": "demo-sara", "1.3": "demo-student", "2.1": "demo-sara", "2.2": "demo-sara", "3.1": "demo-noura", "3.2": "demo-ali", "3.3": "demo-student"}
ACCEPTED_SECTIONS = {
    "1.1": "This document specifies the requirements for **Falcon Finder**, a web application that helps students report, search for and reclaim items lost on campus.",
    "1.2": "Falcon Finder covers reporting a found item, searching reported items, and claiming an item with proof of ownership. Payments, shipping and staff-only inventory tools are out of scope. Scope is informed by interviews with three students at the main library.",
}


def _ensure_student(db: Session, student_id: str, name: str, program: str, year: str, facts: dict[str, list[str]]) -> None:
    if db.get(Student, student_id) is None:
        db.add(Student(id=student_id, display_name=name))
        db.flush()
        db.add(StudentProfile(student_id=student_id, institution="Demo University", program=program, discipline="cs", year_label=year, onboarding_status="done"))
        for category, values in facts.items():
            for value in values:
                db.add(StudentFact(student_id=student_id, category=category, key=value[:120], value_json=json.dumps(value), source_kind="onboarding"))
    if db.get(User, student_id) is None:
        db.add(User(id=student_id, display_name=db.get(Student, student_id).display_name, role="student", student_id=student_id))


def _enroll(db: Session, course_id: str, user_id: str, role: str) -> None:
    if db.scalar(select(CourseEnrollment.id).where(CourseEnrollment.course_id == course_id, CourseEnrollment.user_id == user_id)) is None:
        db.add(CourseEnrollment(course_id=course_id, user_id=user_id, role=role))


def seed_teams(db: Session) -> None:
    if db.get(Team, "team-falcon") is not None:
        return
    base = datetime.now(UTC)

    def ago(days: float) -> datetime:
        return base - timedelta(days=days)

    for student_id, (name, program, year, facts) in STUDENTS.items():
        _ensure_student(db, student_id, name, program, year, facts)
    if db.get(User, INSTRUCTOR_ID) is None:
        db.add(User(id=INSTRUCTOR_ID, display_name="Dr. Layla Haddad", role="instructor"))
    for course_id, code, title in (("course-swe363", "SWE 363", "Software Engineering"), ("course-cs485", "CS 485", "Machine Learning")):
        if db.get(Course, course_id) is None:
            db.add(Course(id=course_id, code=code, title=title, term="Fall 2026", source="manual", external_id=f"demo-{course_id}"))
    db.flush()
    for course_id, students in (("course-swe363", SWE_STUDENTS), ("course-cs485", ML_STUDENTS)):
        _enroll(db, course_id, INSTRUCTOR_ID, "instructor")
        for student_id in students:
            _enroll(db, course_id, student_id, "student")
    for assignment_id, course_id, title, brief, deadline, deliverables, size in (
        ("asg-swe363-term", "course-swe363", "Term project: build and document a campus web app", SWE_BRIEF, datetime(2026, 12, 10, tzinfo=UTC), ["srs", "sds", "spmp"], (3, 4)),
        ("asg-cs485-project", "course-cs485", "Applied ML project", ML_BRIEF, datetime(2026, 12, 17, tzinfo=UTC), ["proposal", "report"], (2, 3)),
    ):
        if db.get(Assignment, assignment_id) is None:
            db.add(Assignment(
                id=assignment_id, course_id=course_id, title=title, brief_json=json.dumps(brief), deadline=deadline,
                deliverables_json=json.dumps(deliverables), rubric_json=json.dumps(brief["rubric"]),
                team_size_min=size[0], team_size_max=size[1], source="manual", external_id=f"demo-{assignment_id}",
            ))
    db.flush()

    team = Team(id="team-falcon", assignment_id="asg-swe363-term", name="Team Falcon", cover_seed="f41c0n5eed01", lead_user_id="demo-student", charter_json=json.dumps(FALCON_CHARTER), created_at=ago(9.2))
    db.add(team)
    db.flush()
    members = {user_id: TeamMember(team_id=team.id, user_id=user_id, role_label=FALCON_CHARTER["roles"][user_id], joined_at=ago(9.2 - index * 0.05)) for index, user_id in enumerate(FALCON)}
    db.add_all(members.values())
    for milestone_id, title, deliverable, due in FALCON_MILESTONES:
        db.add(Milestone(id=milestone_id, team_id=team.id, title=title, deliverable_key=deliverable, due=due, created_at=ago(8.1)))
    db.flush()

    # Collect (when, type, actor, payload) and emit in time order so the replay scrubber is faithful.
    timeline: list[tuple[datetime, str, str | None, dict]] = []
    for index, user_id in enumerate(FALCON):
        timeline.append((ago(9.2 - index * 0.05), "member.joined", user_id, {"user_id": user_id, "display_name": STUDENTS[user_id][0]}))
    for milestone in db.scalars(select(Milestone).where(Milestone.team_id == team.id)).all():
        timeline.append((ago(8.1), "milestone.created", "demo-student", milestone_dict(milestone)))
    for position, (task_id, title, status, assignee, points, milestone_id, depends_on, created, moved) in enumerate(FALCON_TASKS):
        task = Task(id=task_id, team_id=team.id, title=title, status="todo", assignee_id=assignee, estimate_points=points,
                    milestone_id=milestone_id, depends_on_json=json.dumps(depends_on), position=position + 1, created_at=ago(created), updated_at=ago(created))
        db.add(task)
        db.flush()
        timeline.append((ago(created), "task.created", "demo-student", task_dict(task)))
        if moved is not None:
            task.status = status
            task.updated_at = ago(moved)
            timeline.append((ago(moved), "task.moved", assignee, {"id": task_id, "status": status, "position": task.position, "from": "todo"}))

    message_ids = []
    for days, author, text in FALCON_CHAT:
        message = TeamMessage(team_id=team.id, author_user_id=author, kind="text", content=text, created_at=ago(days))
        db.add(message)
        db.flush()
        message_ids.append(message.id)
        timeline.append((ago(days), "message.created", author, message_dict(message)))
    decision = Decision(team_id=team.id, text=FALCON_CHAT[DECISION_INDEX][2], source_message_id=message_ids[DECISION_INDEX], pinned_by="demo-ali", created_at=ago(8.35))
    db.add(decision)
    db.flush()
    timeline.append((ago(8.35), "decision.pinned", "demo-ali", decision_dict(decision)))

    title, outline = OUTLINES["srs"]
    document = TeamDocument(id="doc-falcon-srs", team_id=team.id, kind="srs", title=title, created_at=ago(7.5))
    db.add(document)
    db.flush()
    sections = []
    for position, (key, section_title) in enumerate(outline):
        content = ACCEPTED_SECTIONS.get(key, "")
        section = DocSection(id=f"sec-falcon-srs-{key}", document_id=document.id, key=key, title=section_title, position=position,
                             owner_user_id=SECTION_OWNERS.get(key), content_md=content, status="accepted" if content else "empty", version=1 if content else 0)
        sections.append(section)
    db.add_all(sections)
    db.flush()
    timeline.append((ago(7.5), "document.created", "demo-student", document_dict(document, sections)))
    for section in sections:
        if section.status == "accepted":
            timeline.append((ago(7.0), "section.updated", SECTION_OWNERS[section.key], section_dict(section)))

    timeline.sort(key=lambda item: item[0])
    last_seen_at = ago(FALCON_CHAT[LAST_SEEN_INDEX][0])
    last_seen_seq = 0
    for at, type_, actor, payload in timeline:
        event = emit(db, team.id, type_, actor, payload, created_at=at)
        if at <= last_seen_at:
            last_seen_seq = event.seq
    for member in members.values():
        member.last_seen_seq = last_seen_seq
    db.commit()
```

> **Unread check:** each member's pointer is set to the last event at or before message index 12. For `demo-student`, the unread count is `message.created` events after that pointer written by someone else: indices 13, 14 and 15. That's 3, and the test asserts it.
>
> **Progress check:** the done points are 1 + 2 = 3, out of a total of 1 + 2 + 3 + 3 + 2 + 3 = 14, which rounds to 21%. The test asserts 21.

- [ ] **Step 4: Call the seed at startup**

In `services/api/app/main.py`, add the import `from .teams.seed import seed_teams` near the other team import. In `startup()`, add this right after the existing `db.commit()` and before `finally:`:

```python
        seed_teams(db)
```

- [ ] **Step 5: Record the new invariants in `AGENTS.md`**

Add these bullets to the end of the `## Invariants` list:

```markdown
- Group Projects: every team write emits a `team_events` row in the same transaction; the SSE
  stream, catch-up and replay read only that log. Course instructors see every team except its
  chat (messages, reactions, typing, private notices), enforced in `teams/policy.py` and
  `teams/events.py`, never only in the UI or prompt.
- Identity comes only from `current_user()` in `services/api/app/identity.py` (demo `X-Farq-User`
  header; the SSE stream alone takes `?as=`). Replace that function, not its callers, for real sign-in.
- Team activity never creates `StudentFact` rows.
```

- [ ] **Step 6: Run the whole suite**

Run: `.venv/Scripts/python -m pytest services/api/tests -q`
Expected: 145 passed (92 baseline + 53 new).

- [ ] **Step 7: Commit**

```bash
git add services/api/app/teams/seed.py services/api/app/main.py AGENTS.md services/api/tests/test_teams_seed.py
git commit -m "feat(teams): seed Team Falcon demo world and document Group Projects invariants

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage for this plan:**
  - §3 identity → Task 1
  - §4 tables → Task 2. `team_proposals` and `team_agent_runs` are deferred to Plan 2 by design.
  - §5 permissions → Tasks 2 and 3
  - §6 real-time → Tasks 3 and 8
  - §7 workspace → Tasks 4, 5, 6, 7 and 9
  - §11 seed → Task 10
  - §12 errors → the 4xx paths in each task, plus lock expiry in Task 7
  - §13 backend tests (non-Hermes) → every task
- **Deliberate refinements of the spec, all within its intent:**
  - `team_events.visible_to_user_id` is added (needed by §6).
  - The stream names its viewer with `?as=`, because `EventSource` cannot send headers.
  - Milestone completion emits `task.moved` + `milestone.completed` + one system `message.created`. The spec said "exactly one event", but §7 also asks for a system message. The rule applied is "a rejected write emits none".
  - The seed has 16 chat messages rather than ~30.
