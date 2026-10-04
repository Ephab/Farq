"""Team behavior and races on PostgreSQL, with isolated schemas and accounts."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import time
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import jwt
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from support import ISSUER, make_settings
from collaboration.database import team_session
from collaboration.identity import Identity
from collaboration.main import create_app
from collaboration.teams.models import Course, CourseEnrollment, Assignment, Team, TeamMember, TeamEvent, TeamMessage, Task
from collaboration.teams import events
from collaboration.teams.chat import post_message
from collaboration.teams.proposals import create_proposal, ProposalError


def hdr(name):
    return {"Authorization": "Bearer " + name}


@pytest.fixture
def world(monkeypatch):
    url = os.getenv("COLLAB_TEST_DATABASE_URL")
    if not url:
        pytest.skip("COLLAB_TEST_DATABASE_URL required for team PostgreSQL checks")
    settings = make_settings(url, teams_enabled=True)
    monkeypatch.setenv("COLLAB_DATABASE_URL", url)
    schema = "collab_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        app = create_app(settings)
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        class VerifiedIdentity:
            def verify(self, token):
                if token not in {"alice", "bob", "carol", "instructor", "outsider"}:
                    raise jwt.InvalidTokenError()
                return Identity(ISSUER, token, token.title(), int(time.time()) + 300)
        app.state.verifier = VerifiedIdentity()
        with TestClient(app) as client:
            ids = {name: client.get("/v1/me", headers=hdr(name)).json()["id"]
                   for name in ("alice", "bob", "carol", "instructor", "outsider")}
            with team_session(app.state.sessions) as db:
                course = Course(code="SWE363", title="Software Engineering")
                db.add(course)
                db.flush()
                assignment = Assignment(course_id=course.id, title="Class project", team_size_min=2, team_size_max=4)
                db.add(assignment)
                for name in ("alice", "bob", "carol", "instructor"):
                    db.add(CourseEnrollment(course_id=course.id, user_id=ids[name], role="instructor" if name == "instructor" else "student"))
                db.commit()
                assignment_id = assignment.id
            yield client, app, ids, assignment_id
    finally:
        engine.dispose()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def room(client, name="Project"):
    response = client.post("/v1/teams", json={"name": name}, headers=hdr("alice"))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def join(client, team, ids, member="bob"):
    response = client.post(f"/v1/teams/{team}/invites", json={"user_id": ids[member]}, headers=hdr("alice"))
    assert response.status_code == 201, response.text
    response = client.post(f"/v1/invites/{response.json()['id']}/accept", headers=hdr(member))
    assert response.status_code == 200, response.text


def task(client, team, ids, title="Task"):
    response = client.post(f"/v1/teams/{team}/tasks", json={"title": title, "assignee_id": ids["alice"]}, headers=hdr("alice"))
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_rooms_share_work_and_have_no_fake_course(world):
    client, app, ids, _ = world
    team = room(client)
    join(client, team, ids)
    task_id = task(client, team, ids)
    response = client.post(f"/v1/teams/{team}/messages", json={"content": "Hello team"}, headers=hdr("bob"))
    assert response.status_code == 201
    state = client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).json()
    assert state["tasks"][0]["id"] == task_id
    assert state["messages"][0]["content"] == "Hello team"
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("outsider")).status_code == 403
    with app.state.sessions() as db:
        assert db.get(Team, team).assignment_id is None
        assert [e.type for e in db.scalars(select(TeamEvent).where(TeamEvent.team_id == team).order_by(TeamEvent.seq))][-2:] == ["task.created", "message.created"]
    assert len(client.get("/v1/me/teams-home", headers=hdr("bob")).json()["teams"]) == 1
    # Independent projects have no one-team-per-assignment constraint.
    assert room(client, "Second project") != team


def test_concurrent_final_seat_and_no_duplicate_membership(world):
    client, app, ids, _ = world
    team = room(client)
    invites = [client.post(f"/v1/teams/{team}/invites", json={"user_id": ids[name]}, headers=hdr("alice")).json()["id"]
               for name in ("bob", "carol")]
    assert client.patch(f"/v1/teams/{team}", json={"size_limit": 2}, headers=hdr("alice")).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda pair: client.post(f"/v1/invites/{pair[0]}/accept", headers=hdr(pair[1])), zip(invites, ("bob", "carol"))))
    assert sorted(response.status_code for response in results) == [200, 409]
    with app.state.sessions() as db:
        assert len(db.scalars(select(TeamMember).where(TeamMember.team_id == team)).all()) == 2


def test_instructor_chat_privacy_and_assignment_uniqueness(world):
    client, app, ids, assignment = world
    team = client.post(f"/v1/assignments/{assignment}/teams", json={"name": "Class team"}, headers=hdr("alice")).json()["id"]
    join(client, team, ids)
    assert client.post(f"/v1/assignments/{assignment}/teams", json={"name": "Duplicate"}, headers=hdr("bob")).status_code == 409
    assert client.post(f"/v1/assignments/{assignment}/teams", json={"name": "Impostor"}, headers=hdr("outsider")).status_code == 403
    assert client.post(f"/v1/teams/{team}/messages", json={"content": "Private team chat"}, headers=hdr("alice")).status_code == 201
    with team_session(app.state.sessions) as db:
        post_message(db, team, None, "Private notice", visible_to_user_id=ids["bob"])
        db.commit()
    state = client.get(f"/v1/teams/{team}/state", headers=hdr("instructor")).json()
    assert state["messages"] is None and state["team"]["viewer_role"] == "instructor"
    replay = client.get(f"/v1/teams/{team}/events/replay", headers=hdr("instructor")).json()
    assert all(not event["type"].startswith("message.") for event in replay["events"])
    assert client.post(f"/v1/teams/{team}/messages", json={"content": "No"}, headers=hdr("instructor")).status_code == 403
    assert all(message["content"] != "Private notice" for message in client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).json()["messages"])


def test_document_lock_versions_and_export(world):
    client, _, ids, _ = world
    team = room(client)
    join(client, team, ids)
    document = client.post(f"/v1/teams/{team}/documents", json={"kind": "srs"}, headers=hdr("alice")).json()
    section = document["sections"][0]["id"]
    assert client.post(f"/v1/sections/{section}/lock", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/sections/{section}/lock", headers=hdr("bob")).status_code == 409
    assert client.put(f"/v1/sections/{section}/content", json={"content_md": "Our requirements", "version": 0}, headers=hdr("alice")).status_code == 200
    assert client.put(f"/v1/sections/{section}/content", json={"content_md": "Stale edit", "version": 0}, headers=hdr("alice")).status_code == 409
    exported = client.get(f"/v1/documents/{document['id']}/export?format=md&style=ieee", headers=hdr("bob"))
    assert exported.status_code == 200 and "Our requirements" in exported.text


def test_batch_proposal_stales_atomically_and_lead_override(world):
    client, app, ids, _ = world
    team = room(client)
    join(client, team, ids)
    first, second = task(client, team, ids, "First"), task(client, team, ids, "Second")
    with team_session(app.state.sessions) as db:
        proposal = create_proposal(db, db.get(Team, team), "batch", {"ops": [
            {"kind": "task_edit", "payload": {"task_id": first, "changes": {"title": "Changed"}}},
            {"kind": "task_delete", "payload": {"task_ids": [second], "rationale": "Remove duplicate"}},
        ]}, summary="Batch", invoked_by=ids["alice"])
        db.commit()
        proposal_id = proposal.id
    assert client.post(f"/v1/tasks/{second}/move", json={"status": "doing"}, headers=hdr("alice")).status_code == 200
    result = client.post(f"/v1/proposals/{proposal_id}/accept", headers=hdr("alice"))
    assert result.status_code == 200 and result.json()["status"] == "stale"
    state = client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).json()
    assert next(item for item in state["tasks"] if item["id"] == first)["title"] == "First"
    with team_session(app.state.sessions) as db:
        proposal = create_proposal(db, db.get(Team, team), "charter", {"charter": {"goal": "Ship"}}, summary="Goal", invoked_by=ids["alice"])
        db.commit()
        proposal_id = proposal.id
    result = client.post(f"/v1/proposals/{proposal_id}/accept", headers=hdr("alice"))
    assert result.json()["status"] == "applied" and result.json()["decided_via"] == "lead_override"


def test_stream_replay_and_removal(world, monkeypatch):
    client, app, ids, _ = world
    team = room(client)
    join(client, team, ids)
    task(client, team, ids)
    monkeypatch.setattr(events, "MAX_POLLS", 1)
    response = client.get(f"/v1/teams/{team}/events", headers=hdr("bob"))
    assert response.status_code == 200 and "event: task.created" in response.text
    replay = client.get(f"/v1/teams/{team}/events/replay", headers=hdr("bob")).json()
    assert client.get(f"/v1/teams/{team}/events/replay?after={replay['cursor']}", headers=hdr("bob")).json()["events"] == []
    assert client.get(f"/v1/teams/{team}/events?as=bob").status_code == 401
    assert client.delete(f"/v1/teams/{team}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/events/replay", headers=hdr("bob")).status_code == 403
    assert client.get(f"/v1/teams/{team}/events", headers=hdr("bob")).status_code == 403
    assert client.post(f"/v1/teams/{team}/messages", json={"content": "After removal"}, headers=hdr("bob")).status_code == 403


def test_agent_and_import_capabilities_are_explicitly_unavailable(world):
    client, _, _, _ = world
    team = room(client)
    assert client.post(f"/v1/teams/{team}/messages", json={"content": "@Hermes split the work"}, headers=hdr("alice")).status_code == 503
    capabilities = client.get("/v1/capabilities", headers=hdr("alice")).json()
    assert capabilities == {"api_version": 1, "min_client_version": "0.0.0", "teams": True, "team_ai": False, "project_import": False, "discovery": True}
    assert client.get("/api/demo/users").status_code == 404
    assert client.post("/internal/hermes/waypoint_get_team_context").status_code == 404
