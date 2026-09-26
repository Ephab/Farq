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
