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
                db.add(TeamMember(team_id=team.id, assignment_id=assignment.id, user_id=student_id))
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
