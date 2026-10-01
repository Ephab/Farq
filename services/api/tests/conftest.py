import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

# Make `import app` work when pytest runs from the repo root (the documented command).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
# The API has no built-in internal token; tests use a fixed one.
os.environ.setdefault("WAYPOINT_INTERNAL_TOKEN", "waypoint-internal-dev")
# Tests stub the Hermes gateway; never let extraction reach a real model API with a developer's keys.
os.environ["WAYPOINT_DIRECT_EXTRACT"] = "off"

OWNED_PREFIXES = ("/api/students/", "/api/chat/threads/", "/api/agent-runs/", "/api/roadmap-proposals/",
                  "/api/projects/", "/api/evaluations/")
NO_AUTO = "x-test-no-auto"


def _owner_for(path: str) -> str | None:
    """The student who owns the record in an API path, as the browser's current student would be."""
    from app.database import SessionLocal
    from app.models import AgentRun, ChatThread, Project, ProjectEvaluation, RoadmapProposal

    parts = [unquote(part) for part in path.split("/") if part]
    if len(parts) < 3:
        return None
    kind, ident = parts[1], parts[2]
    db = SessionLocal()
    try:
        if kind == "students":
            return ident
        if kind == "chat":
            thread = db.get(ChatThread, parts[3]) if len(parts) > 3 else None
            return thread.student_id if thread else None
        if kind == "agent-runs":
            run = db.get(AgentRun, ident)
            thread = db.get(ChatThread, run.thread_id) if run else None
            return thread.student_id if thread else None
        if kind == "roadmap-proposals":
            item = db.get(RoadmapProposal, ident)
            return item.student_id if item else None
        if kind == "projects":
            item = db.get(Project, ident)
            return item.student_id if item else None
        if kind == "evaluations":
            item = db.get(ProjectEvaluation, ident)
            project = db.get(Project, item.project_id) if item else None
            return project.student_id if project else None
    finally:
        db.close()
    return None


def _grant_student(path: str, body) -> str | None:
    from app.database import SessionLocal
    from app.models import Project, Student
    from sqlalchemy import func, select

    parts = [unquote(part) for part in path.split("/") if part]
    claimed = None
    if len(parts) > 3 and parts[2] == "students":
        claimed = parts[3]
    elif isinstance(body, dict) and body.get("user_id"):
        claimed = body["user_id"]
    db = SessionLocal()
    try:
        if len(parts) > 3 and parts[2] == "projects":
            project = db.get(Project, parts[3])
            return project.student_id if project else None
        if claimed is None:
            return None
        if db.get(Student, claimed) is not None:
            return claimed
        matches = db.scalars(select(Student).where(func.lower(Student.display_name) == claimed.strip().lower())).all()
        return matches[0].id if len(matches) == 1 else None
    finally:
        db.close()


def issue_test_grant(student_id: str, scopes=("read", "facts", "proposals", "evidence", "projects"), **kwargs) -> str:
    from app.database import SessionLocal
    from app.tool_grants import issue_grant

    db = SessionLocal()
    try:
        token = issue_grant(db, student_id, tuple(scopes), **kwargs)
        db.commit()
        return token
    finally:
        db.close()


@pytest.fixture(autouse=True)
def _act_as_record_owner(monkeypatch):
    """Send what the real clients send: the browser's current student as `X-Waypoint-User`, and
    Hermes' run grant as `X-Waypoint-Grant`. Tests that check the guards set these headers
    themselves (or `X-Test-No-Auto: 1` to send neither)."""
    from starlette.testclient import TestClient

    original = TestClient.request

    def request(self, method, url, *args, **kwargs):
        headers = {key: value for key, value in dict(kwargs.get("headers") or {}).items()}
        lower = {key.lower() for key in headers}
        path = urlparse(str(url)).path
        if NO_AUTO in lower:
            headers = {key: value for key, value in headers.items() if key.lower() != NO_AUTO}
        else:
            if path.startswith(OWNED_PREFIXES) and "x-waypoint-user" not in lower:
                owner = _owner_for(path)
                if owner:
                    headers["X-Waypoint-User"] = owner
            if path.startswith("/internal/hermes/") and not path.startswith("/internal/hermes/teams") \
                    and "x-waypoint-grant" not in lower and "x-waypoint-internal-token" in lower:
                student = _grant_student(path, kwargs.get("json"))
                if student:
                    headers["X-Waypoint-Grant"] = issue_test_grant(student)
        kwargs["headers"] = headers
        return original(self, method, url, *args, **kwargs)

    monkeypatch.setattr(TestClient, "request", request)
