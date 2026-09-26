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
