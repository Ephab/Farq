from team_world import client, events_for, hdr, make_world  # noqa: F401


def test_lead_renames_the_team_and_sets_its_size(client):
    world = make_world(students=5, team_members=2, size_max=4)
    team, lead = world["team_id"], world["students"][0]
    updated = client.patch(f"/api/teams/{team}", json={"name": "  Falcon Squad  ", "size_limit": 3}, headers=hdr(lead))
    assert updated.status_code == 200, updated.text
    assert (updated.json()["name"], updated.json()["size_limit"]) == ("Falcon Squad", 3)
    event = events_for(team)[-1]
    assert (event["type"], event["payload"]) == ("team.updated", {"name": "Falcon Squad", "size_limit": 3})


def test_only_the_lead_can_edit_the_team(client):
    world = make_world()
    url = f"/api/teams/{world['team_id']}"
    assert client.patch(url, json={"name": "Mine now"}, headers=hdr(world["students"][1])).status_code == 403
    assert client.patch(url, json={"name": "Mine now"}, headers=hdr(world["instructor"])).status_code == 403


def test_size_stays_between_members_and_the_course_maximum(client):
    world = make_world(students=5, team_members=3, size_max=4)
    url, lead = f"/api/teams/{world['team_id']}", world["students"][0]
    assert client.patch(url, json={"size_limit": 2}, headers=hdr(lead)).status_code == 422
    assert client.patch(url, json={"size_limit": 5}, headers=hdr(lead)).status_code == 422
    assert client.patch(url, json={"name": " "}, headers=hdr(lead)).status_code == 422


def test_invites_follow_the_team_size(client):
    world = make_world(students=5, team_members=2, size_max=4)
    team, lead = world["team_id"], world["students"][0]
    client.patch(f"/api/teams/{team}", json={"size_limit": 2}, headers=hdr(lead))
    assert client.post(f"/api/teams/{team}/invites", json={"user_id": world["students"][3]}, headers=hdr(lead)).status_code == 409
    client.patch(f"/api/teams/{team}", json={"size_limit": 3}, headers=hdr(lead))
    assert client.post(f"/api/teams/{team}/invites", json={"user_id": world["students"][3]}, headers=hdr(lead)).status_code == 201


def test_member_leaves_and_lead_can_leave_without_stranding_members(client):
    world = make_world(team_members=3)
    team, lead, second, third = world["team_id"], *world["students"][:3]
    assert client.post(f"/api/teams/{team}/leave", headers=hdr(world["instructor"])).status_code == 403
    assert client.post(f"/api/teams/{team}/leave", headers=hdr(third)).json() == {"left": True}
    assert client.get(f"/api/teams/{team}/state", headers=hdr(third)).status_code == 403
    assert client.post(f"/api/teams/{team}/leave", headers=hdr(lead)).status_code == 200
    response = client.get(f"/api/teams/{team}", headers=hdr(second))
    assert response.json()["lead_user_id"] == second
    assert events_for(team)[-1]["type"] == "member.removed"


def test_lead_edits_project_and_team_assignment_brief(client):
    world = make_world(team_members=2)
    team, lead, member, other = world["team_id"], *world["students"][:3]
    sibling = client.post(f"/api/assignments/{world['assignment_id']}/teams", json={"name": "Other team"}, headers=hdr(other)).json()
    original = client.get(f"/api/teams/{sibling['id']}", headers=hdr(other)).json()["assignment"]
    body = {"project": {"brief": {"problem": "Our chosen problem", "tools": ["Python"]}, "deliverables": [{"key": "report", "title": "Final report", "due": None, "doc_kind": None}]},
            "assignment": {"title": "Team interpretation", "problem": "Edited assignment", "objective": "Deliver a prototype", "constraints": ["One semester"], "deliverables": ["Prototype"]}}
    for who in [member, world["instructor"], other]:
        assert client.patch(f"/api/teams/{team}/project-details", json=body, headers=hdr(who)).status_code == 403
    saved = client.patch(f"/api/teams/{team}/project-details", json=body, headers=hdr(lead))
    assert saved.status_code == 200, saved.text
    state = client.get(f"/api/teams/{team}/state", headers=hdr(member)).json()
    assert state["team"]["project"]["brief"]["problem"] == "Our chosen problem"
    assert state["team"]["assignment"]["title"] == "Team interpretation"
    assert client.get(f"/api/teams/{sibling['id']}", headers=hdr(other)).json()["assignment"] == original
    event = events_for(team)[-1]
    assert event["type"] == "team.updated" and event["payload"]["assignment"]["brief"]["problem"] == "Edited assignment"
