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
