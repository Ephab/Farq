"""Regression tests for the Plan 1 whole-branch review findings."""
import threading
import time

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.teams import chat as chat_module
from app.teams import teams as teams_module


def test_racing_team_creation_cannot_put_a_student_on_two_teams(client, monkeypatch):
    world = make_world(students=4, team_members=0)
    url = f"/api/assignments/{world['assignment_id']}/teams"
    s0 = world["students"][0]
    assert client.post(url, json={"name": "First"}, headers=hdr(s0)).status_code == 201
    # Simulate the second request having passed the check before the first committed.
    monkeypatch.setattr(teams_module, "team_for_assignment", lambda *args: None)
    assert client.post(url, json={"name": "Second"}, headers=hdr(s0)).status_code == 409


def test_joining_a_team_cancels_other_pending_invites_for_the_assignment(client):
    world = make_world(students=5, team_members=3, size_max=4)
    s0, _, _, x, y = world["students"]
    invites = f"/api/teams/{world['team_id']}/invites"
    assert client.post(invites, json={"user_id": x}, headers=hdr(s0)).status_code == 201
    assert client.post(f"/api/assignments/{world['assignment_id']}/teams", json={"name": "X's team"}, headers=hdr(x)).status_code == 201
    assert client.get("/api/me/teams-home", headers=hdr(x)).json()["invites"] == []
    assert client.post(invites, json={"user_id": y}, headers=hdr(s0)).status_code == 201


def test_adding_open_work_reopens_a_completed_milestone(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    milestone = client.post(f"/api/teams/{team}/milestones", json={"title": "SRS"}, headers=hdr(s0)).json()
    first = client.post(f"/api/teams/{team}/tasks", json={"title": "A", "milestone_id": milestone["id"]}, headers=hdr(s0)).json()
    client.post(f"/api/tasks/{first['id']}/move", json={"status": "done"}, headers=hdr(s0))
    client.post(f"/api/teams/{team}/tasks", json={"title": "B", "milestone_id": milestone["id"]}, headers=hdr(s0))
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()
    assert state["milestones"][0]["completed_at"] is None


def test_due_dates_with_an_offset_are_stored_in_utc(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    task = client.post(f"/api/teams/{team}/tasks", json={"title": "A", "due": "2026-10-01T10:00:00+03:00"}, headers=hdr(s0)).json()
    milestone = client.post(f"/api/teams/{team}/milestones", json={"title": "M", "due": "2026-10-01T10:00:00+03:00"}, headers=hdr(s0)).json()
    assert task["due"] == "2026-10-01T07:00:00+00:00"
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()
    assert state["tasks"][0]["due"] == "2026-10-01T07:00:00+00:00"
    assert state["milestones"][0]["due"] == milestone["due"] == "2026-10-01T07:00:00+00:00"


def test_concurrent_poll_votes_are_all_kept(client, monkeypatch):
    world = make_world(students=4, team_members=4)
    team, s0 = world["team_id"], world["students"][0]
    poll = client.post(f"/api/teams/{team}/messages", json={"content": "When?", "poll_options": ["Sun", "Tue"]}, headers=hdr(s0)).json()
    real_loads = chat_module.loads

    def slow_loads(*args):
        value = real_loads(*args)
        time.sleep(0.2)  # widen the read-modify-write window
        return value

    monkeypatch.setattr(chat_module, "loads", slow_loads)
    voters = world["students"][1:]
    threads = [threading.Thread(target=client.post, args=(f"/api/messages/{poll['id']}/poll-vote",), kwargs={"json": {"option": 1}, "headers": hdr(voter)}) for voter in voters]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    monkeypatch.setattr(chat_module, "loads", real_loads)
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()
    stored = next(message for message in state["messages"] if message["id"] == poll["id"])
    assert stored["metadata"]["votes"] == {voter: 1 for voter in voters}


def test_non_finite_positions_are_rejected(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    task = client.post(f"/api/teams/{team}/tasks", json={"title": "A"}, headers=hdr(s0)).json()
    response = client.post(f"/api/tasks/{task['id']}/move", content='{"status": "doing", "position": 1e999}', headers={**hdr(s0), "Content-Type": "application/json"})
    assert response.status_code == 422


def test_lock_heartbeat_tells_teammates_the_new_expiry(client):
    world = make_world()
    s0 = world["students"][0]
    document = client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "srs"}, headers=hdr(s0)).json()
    section = next(item for item in document["sections"] if item["key"] == "3.2")
    first = client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s0)).json()
    renewed = client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s0)).json()
    locks = [event for event in events_for(world["team_id"]) if event["type"] == "section.locked"]
    assert len(locks) == 2
    assert locks[-1]["payload"]["lock_expires_at"] == renewed["lock_expires_at"] >= first["lock_expires_at"]
