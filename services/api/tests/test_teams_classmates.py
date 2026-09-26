from team_world import client, hdr, make_world  # noqa: F401


def test_classmates_lists_enrolled_students_with_team_flags(client):
    world = make_world(students=4, team_members=2)
    s0, s1, s2, s3 = world["students"]
    response = client.get(f"/api/assignments/{world['assignment_id']}/classmates", headers=hdr(s0))
    assert response.status_code == 200, response.text
    assert {row["user_id"]: row["has_team"] for row in response.json()} == {s1: True, s2: False, s3: False}


def test_classmates_requires_enrollment(client):
    world = make_world()
    url = f"/api/assignments/{world['assignment_id']}/classmates"
    assert client.get(url, headers=hdr(world["outsider"])).status_code == 403
    assert client.get(url, headers=hdr(world["instructor"])).status_code == 200
