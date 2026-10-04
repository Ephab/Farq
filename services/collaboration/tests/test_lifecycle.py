from sqlalchemy import select
from test_team_port import world, hdr, room, join, task
from test_classes import make_class, code, redeem
from test_openings import setup, apply
from collaboration.teams.models import TeamEvent, CourseEnrollment, Course
from collaboration.models import Account


def test_class_owner_transfer_does_not_grant_instructor_rights_or_reset_quota(world):
    client, app, ids, _ = world
    class_id, _, team = setup(client)
    assert client.post(f"/v1/classes/{class_id}/organizer", headers=hdr("alice"), json={"account_id": ids["outsider"]}).status_code == 409
    assert client.post(f"/v1/classes/{class_id}/organizer", headers=hdr("bob"), json={"account_id": ids["bob"]}).status_code == 403
    assert client.post(f"/v1/classes/{class_id}/organizer", headers=hdr("alice"), json={"account_id": ids["bob"]}).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/archive", headers=hdr("alice")).status_code == 403
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).status_code == 403
    with app.state.sessions() as db:
        assert db.get(Course, class_id).creator_id == ids["alice"]
        assert db.scalar(select(CourseEnrollment.role).where(CourseEnrollment.course_id == class_id, CourseEnrollment.user_id == ids["bob"])) == "student"
    make_class(client); make_class(client)
    assert client.post("/v1/classes", headers=hdr("alice"), json={"title": "Fourth"}).status_code == 429


def test_archive_class_suspends_access_and_restore_does_not_revive_invites(world):
    client, _, _, _ = world
    class_id, assignment, team = setup(client)
    request_id = apply(client, team)
    class_code = code(client, f"/v1/classes/{class_id}")
    project_code = code(client, f"/v1/teams/{team}")
    assert client.post(f"/v1/classes/{class_id}/archive", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/archive", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/classes/{class_id}", headers=hdr("bob")).json()["archived"] is True
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).status_code == 404
    assert client.post(f"/v1/teams/{team}/messages", headers=hdr("alice"), json={"content": "Blocked"}).status_code == 404
    assert client.get(f"/v1/teams/{team}/events/replay", headers=hdr("alice")).status_code == 404
    assert client.get(f"/v1/teams/{team}/events", headers=hdr("alice")).status_code == 404
    assert client.post(f"/v1/assignments/{assignment}/teams", headers=hdr("bob"), json={"name": "Blocked"}).status_code == 404
    assert client.get("/v1/me/teams-home", headers=hdr("alice")).json()["teams"] == []
    assert client.post(f"/v1/classes/{class_id}/restore", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/classes/{class_id}/openings", headers=hdr("bob")).json() == []
    assert redeem(client, class_code, "carol").status_code == 404
    assert redeem(client, project_code).status_code == 404
    assert client.get("/v1/me/join-requests", headers=hdr("bob")).json()[0]["status"] == "cancelled"
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 409


def test_project_archive_preserves_history_and_is_lead_only(world):
    client, app, ids, _ = world
    team = room(client)
    join(client, team, ids)
    task_id = task(client, team, ids)
    invitation = code(client, f"/v1/teams/{team}")
    invite = client.post(f"/v1/teams/{team}/invites", headers=hdr("alice"), json={"user_id": ids["carol"]}).json()["id"]
    assert client.post(f"/v1/teams/{team}/archive", headers=hdr("bob")).status_code == 403
    assert client.post(f"/v1/teams/{team}/archive", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).status_code == 404
    assert client.get("/v1/me/archived-teams", headers=hdr("bob")).json()[0]["can_restore"] is False
    assert client.get("/v1/me/archived-teams", headers=hdr("outsider")).json() == []
    assert client.post(f"/v1/teams/{team}/restore", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).json()["tasks"][0]["id"] == task_id
    assert redeem(client, invitation, "carol").status_code == 404
    assert client.post(f"/v1/invites/{invite}/accept", headers=hdr("carol")).status_code == 409
    with app.state.sessions() as db:
        assert set(db.scalars(select(TeamEvent.type).where(TeamEvent.team_id == team))) >= {"team.archived", "team.restored", "invite.cancelled"}


def test_class_restore_keeps_individually_archived_project_closed(world):
    client, app, ids, _ = world
    class_id, _, team = setup(client)
    with app.state.sessions() as db:
        db.get(Account, ids["bob"]).disabled = True
        db.commit()
    assert client.post(f"/v1/classes/{class_id}/organizer", headers=hdr("alice"), json={"account_id": ids["bob"]}).status_code == 409
    assert client.post(f"/v1/teams/{team}/archive", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/archive", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/teams/{team}/restore", headers=hdr("alice")).status_code == 409
    assert client.post(f"/v1/classes/{class_id}/restore", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).status_code == 404
