from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from sqlalchemy import select
from test_team_port import world, hdr
from test_classes import make_class, code, redeem
from collaboration.models import now
from collaboration.openings import JoinRequest, TeamOpening
from collaboration.teams.models import TeamEvent


def setup(client, limit=3):
    class_id = make_class(client)
    invite = code(client, f"/v1/classes/{class_id}")
    for who in ("bob", "carol"):
        assert redeem(client, invite, who).status_code == 200
    assignment = client.post(f"/v1/classes/{class_id}/assignments", headers=hdr("alice"), json={"title": "Project", "team_size_max": limit}).json()["id"]
    team = client.post(f"/v1/assignments/{assignment}/teams", headers=hdr("alice"), json={"name": "Open project"}).json()["id"]
    assert client.put(f"/v1/teams/{team}/opening", headers=hdr("alice"), json={"summary": "Build a student planner", "roles": ["Designer"], "commitment": "Two meetings weekly"}).status_code == 200
    return class_id, assignment, team


def apply(client, team, who="bob"):
    result = client.post(f"/v1/teams/{team}/join-requests", headers=hdr(who), json={"note": "I would like to help with design"})
    assert result.status_code == 201
    return result.json()["id"]


def test_openings_are_class_scoped_and_requests_private(world):
    client, app, ids, _ = world
    class_id, _, team = setup(client)
    assert client.get(f"/v1/classes/{class_id}/openings", headers=hdr("outsider")).status_code == 404
    opening = client.get(f"/v1/classes/{class_id}/openings", headers=hdr("bob")).json()[0]
    assert opening["roles"] == ["Designer"] and opening["places"] == 2
    assert "members" not in opening and "messages" not in opening
    request_id = apply(client, team)
    assert apply(client, team) == request_id
    assert client.get(f"/v1/teams/{team}/join-requests", headers=hdr("carol")).status_code == 403
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).status_code == 403
    with app.state.sessions() as db:
        event = db.scalar(select(TeamEvent).where(TeamEvent.type == "join_request.created", TeamEvent.team_id == team))
        assert event.visible_to_user_id == ids["alice"] and "design" not in event.payload_json
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("bob")).status_code == 403
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/state", headers=hdr("bob")).status_code == 200


def test_concurrent_approvals_cannot_overfill(world):
    client, _, _, _ = world
    _, _, team = setup(client, limit=2)
    requests = [apply(client, team, who) for who in ("bob", "carol")]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda id: client.post(f"/v1/join-requests/{id}/accept", headers=hdr("alice")), requests))
    assert sorted(row.status_code for row in results) == [200, 409]
    assert len(client.get(f"/v1/teams/{team}/state", headers=hdr("alice")).json()["team"]["members"]) == 2


def test_expiry_closure_and_cancellation(world):
    client, app, _, _ = world
    _, _, team = setup(client)
    request_id = apply(client, team)
    assert client.post(f"/v1/join-requests/{request_id}/cancel", headers=hdr("carol")).status_code == 404
    assert client.post(f"/v1/join-requests/{request_id}/cancel", headers=hdr("bob")).status_code == 200
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 409
    request_id = apply(client, team, "carol")
    with app.state.sessions() as db:
        db.get(JoinRequest, request_id).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 409
    assert client.get("/v1/me/join-requests", headers=hdr("carol")).json()[0]["status"] == "expired"
    assert client.delete(f"/v1/teams/{team}/opening", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/teams/{team}/join-requests", headers=hdr("bob"), json={}).status_code == 404


def test_removed_student_cannot_be_accepted_and_other_assignment_team_conflicts(world):
    client, _, ids, _ = world
    class_id, assignment, team = setup(client)
    request_id = apply(client, team)
    assert client.delete(f"/v1/classes/{class_id}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 404
    request_id = apply(client, team, "carol")
    assert client.post(f"/v1/assignments/{assignment}/teams", headers=hdr("carol"), json={"name": "Other team"}).status_code == 201
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 409


def test_expired_opening_and_ineligible_discovery(world):
    client, app, _, _ = world
    class_id, _, team = setup(client)
    request_id = apply(client, team)
    with app.state.sessions() as db:
        db.get(TeamOpening, team).expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert client.get(f"/v1/classes/{class_id}/openings", headers=hdr("bob")).json() == []
    assert client.post(f"/v1/join-requests/{request_id}/accept", headers=hdr("alice")).status_code == 409
