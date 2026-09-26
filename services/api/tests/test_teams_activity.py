from team_world import client, hdr, make_world  # noqa: F401


def _texts(client, team, user, **params):
    response = client.get(f"/api/teams/{team}/activity", params=params, headers=hdr(user))
    assert response.status_code == 200, response.text
    return response.json()


def test_activity_describes_creating_reassigning_and_deleting_tasks(client):
    world = make_world()
    team, s0, s1, s2 = world["team_id"], world["students"][0], world["students"][1], world["students"][2]
    task = client.post(f"/api/teams/{team}/tasks", json={"title": "ERD", "assignee_id": s1}, headers=hdr(s0)).json()
    client.patch(f"/api/tasks/{task['id']}", json={"assignee_id": s2}, headers=hdr(s0))
    client.post(f"/api/tasks/{task['id']}/move", json={"status": "doing"}, headers=hdr(s2))
    client.delete(f"/api/tasks/{task['id']}", headers=hdr(s0))
    entries = _texts(client, team, s1)["entries"]
    texts = [entry["text"] for entry in entries]
    names = {s0: "Student 0", s1: "Student 1", s2: "Student 2"}
    assert texts[0] == "deleted task “ERD”"
    assert texts[1] == "moved “ERD” to Doing"
    assert texts[2].startswith("reassigned “ERD” from Student 1") and "to Student 2" in texts[2]
    assert texts[3].startswith("added task “ERD” for Student 1")
    assert entries[0]["actor"].startswith(names[s0])


def test_activity_skips_chat_and_is_visible_to_instructors(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    client.post(f"/api/teams/{team}/messages", json={"content": "secret chat"}, headers=hdr(s0))
    client.post(f"/api/teams/{team}/tasks", json={"title": "Report"}, headers=hdr(s0))
    entries = _texts(client, team, world["instructor"])["entries"]
    assert [entry["text"] for entry in entries] == ["added task “Report”"]
    assert client.get(f"/api/teams/{team}/activity", headers=hdr(world["outsider"])).status_code == 403


def test_activity_pages_backwards(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    for index in range(5):
        client.post(f"/api/teams/{team}/tasks", json={"title": f"T{index}"}, headers=hdr(s0))
    first = _texts(client, team, s0, limit=3)
    assert [entry["text"] for entry in first["entries"]] == ["added task “T4”", "added task “T3”", "added task “T2”"]
    rest = _texts(client, team, s0, limit=3, before=first["next_before"])
    assert [entry["text"] for entry in rest["entries"]] == ["added task “T1”", "added task “T0”"]
    assert rest["next_before"] is None
