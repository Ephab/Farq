from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from sqlalchemy import select
from test_team_port import world, hdr, room  # shared isolated PostgreSQL fixture
from collaboration.invitations import CodeInvite
from collaboration.models import now
from collaboration.teams.models import CourseEnrollment


def make_class(client):
    result = client.post("/v1/classes", headers=hdr("alice"), json={"title": "Computing class"})
    assert result.status_code == 201
    return result.json()["id"]


def code(client, path, **kwargs):
    response = client.post(path + "/codes", headers=hdr("alice"), json=kwargs)
    assert response.status_code == 201
    return response.json()


def redeem(client, invite, who="bob"):
    return client.post("/v1/codes/redeem", headers=hdr(who), json={"code": invite["code"]})


def test_peer_class_roles_and_assignment_privacy(world):
    client, app, ids, _ = world
    class_id = make_class(client)
    invite = code(client, f"/v1/classes/{class_id}")
    assert redeem(client, invite).json() == {"class_id": class_id}
    assert redeem(client, invite).status_code == 200  # idempotent while authorized
    assert client.get(f"/v1/classes/{class_id}", headers=hdr("outsider")).status_code == 404
    assert client.post(f"/v1/classes/{class_id}/assignments", headers=hdr("bob"), json={"title": "Project"}).status_code == 403
    assignment = client.post(f"/v1/classes/{class_id}/assignments", headers=hdr("alice"), json={"title": "Project"}).json()["id"]
    team = client.post(f"/v1/assignments/{assignment}/teams", headers=hdr("bob"), json={"name": "Bob project"}).json()["id"]
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).status_code == 403
    with app.state.sessions() as db:
        assert db.scalar(select(CourseEnrollment.role).where(CourseEnrollment.course_id == class_id, CourseEnrollment.user_id == ids["alice"])) == "student"


def test_codes_are_hashed_expiring_and_revocable(world):
    client, app, _, _ = world
    class_id = make_class(client)
    invite = code(client, f"/v1/classes/{class_id}")
    with app.state.sessions() as db:
        stored = db.get(CodeInvite, invite["id"])
        assert invite["code"].replace("-", "") not in stored.code_hash
        stored.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert redeem(client, invite).status_code == 404
    invite = code(client, f"/v1/classes/{class_id}")
    assert client.delete(f"/v1/codes/{invite['id']}", headers=hdr("bob")).status_code == 404
    assert client.delete(f"/v1/codes/{invite['id']}", headers=hdr("alice")).status_code == 200
    assert redeem(client, invite).status_code == 404


def test_room_code_final_seat_race_and_scope(world):
    client, app, _, _ = world
    team = room(client)
    assert client.patch(f"/v1/teams/{team}", headers=hdr("alice"), json={"size_limit": 2}).status_code == 200
    invite = code(client, f"/v1/teams/{team}", max_uses=1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda who: redeem(client, invite, who), ("bob", "carol")))
    assert sorted(response.status_code for response in responses) in ([200, 404], [200, 409])
    with app.state.sessions() as db:
        assert db.get(CodeInvite, invite["id"]).uses == 1
    state = client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).json()
    assert len(state["team"]["members"]) == 2


def test_class_removal_revokes_team_access_and_old_codes(world):
    client, _, ids, _ = world
    class_id = make_class(client)
    invitation = code(client, f"/v1/classes/{class_id}")
    assert redeem(client, invitation).status_code == 200
    assignment = client.post(f"/v1/classes/{class_id}/assignments", headers=hdr("alice"), json={"title": "Project"}).json()["id"]
    team = client.post(f"/v1/assignments/{assignment}/teams", headers=hdr("alice"), json={"name": "Project"}).json()["id"]
    invitation = code(client, f"/v1/teams/{team}")
    assert redeem(client, invitation, "carol").status_code == 403
    assert redeem(client, invitation).status_code == 200
    assert client.delete(f"/v1/classes/{class_id}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).status_code == 403
    assert redeem(client, code(client, f"/v1/classes/{class_id}")).status_code == 404


def test_limits_persist_failed_redemptions(world):
    client, _, _, _ = world
    for _ in range(10):
        assert redeem(client, {"code": "UNKNOWN"}).status_code == 404
    assert redeem(client, {"code": "UNKNOWN"}).status_code == 429
    for _ in range(3):
        make_class(client)
    assert client.post("/v1/classes", headers=hdr("alice"), json={"title": "Fourth"}).status_code == 429


def test_class_removal_requires_lead_transfer(world):
    client, _, ids, _ = world
    class_id = make_class(client)
    assert redeem(client, code(client, f"/v1/classes/{class_id}")).status_code == 200
    assignment = client.post(f"/v1/classes/{class_id}/assignments", headers=hdr("alice"), json={"title": "Project"}).json()["id"]
    team = client.post(f"/v1/assignments/{assignment}/teams", headers=hdr("bob"), json={"name": "Project"}).json()["id"]
    assert client.delete(f"/v1/classes/{class_id}/members/{ids['bob']}", headers=hdr("alice")).status_code == 409
    invite = client.post(f"/v1/teams/{team}/invites", headers=hdr("bob"), json={"user_id": ids["alice"]}).json()
    assert client.post(f"/v1/invites/{invite['id']}/accept", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/teams/{team}/lead", headers=hdr("bob"), json={"user_id": ids["alice"]}).status_code == 200
    assert client.delete(f"/v1/classes/{class_id}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
