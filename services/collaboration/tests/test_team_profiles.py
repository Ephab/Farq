import json
from sqlalchemy import select
from test_team_port import world, hdr, join
from test_openings import setup
from test_profiles import publish
from collaboration.team_profiles import TeamProfile, TeamConsentAudit
from collaboration.teams.models import CourseEnrollment, TeamEvent


def team_publish(client, team, who="alice", discovery=False, version=0, **fields):
    return client.put(f"/v1/teams/{team}/profile", headers=hdr(who), json={
        "reviewed": True, "expected_version": version, "discovery": discovery, "profile": fields})


def find(client, class_id, assignment, who="bob"):
    return client.post(f"/v1/classes/{class_id}/discovery/team-matches", headers=hdr(who), json={"assignment_id": assignment})


def test_team_consent_is_separate_and_instructors_cannot_read(world):
    client, app, ids, _ = world
    class_id, _, team = setup(client)
    publish(client, class_id, "alice", skills=["Class only"])
    assert client.get(f"/v1/teams/{team}/profile", headers=hdr("alice")).json()["published"] is False
    assert client.get(f"/v1/teams/{team}/profiles", headers=hdr("bob")).status_code == 403
    assert team_publish(client, team, skills=["Private team"]).status_code == 200
    with app.state.sessions() as db:
        db.add(CourseEnrollment(course_id=class_id, user_id=ids["instructor"], role="instructor"))
        db.commit()
    assert client.get(f"/v1/teams/{team}/profiles", headers=hdr("instructor")).status_code == 403
    replay = client.get(f"/v1/teams/{team}/events/replay", headers=hdr("instructor")).json()
    assert not any(event["type"].startswith("profile.") for event in replay["events"])
    assert team_publish(client, team, version=0).status_code == 409
    with app.state.sessions() as db:
        events = db.scalars(select(TeamEvent).where(TeamEvent.team_id == team, TeamEvent.type == "profile.updated")).all()
        assert len(events) == 1 and "Private team" not in events[0].payload_json


def test_existing_team_matching_uses_only_discovery_consent_and_rechecks_snapshot(world):
    client, _, _, _ = world
    class_id, assignment, team = setup(client)
    publish(client, class_id, "bob", skills=["Design"], hours_per_week=5, languages=["English"], meeting_slots=[9])
    team_publish(client, team, skills=["Python"], hours_per_week=5, languages=["English"], meeting_slots=[9])
    prefs = f"/v1/classes/{class_id}/preferences"
    client.put(prefs, headers=hdr("bob"), json={"required_skills": ["Python"]})
    assert find(client, class_id, assignment).json()["teams"] == []
    assert team_publish(client, team, discovery=True, version=1, skills=["Python"], hours_per_week=5, languages=["English"], meeting_slots=[9]).status_code == 200
    client.put(prefs, headers=hdr("bob"), json={"required_skills": ["Python"], "required_languages": ["English"], "min_hours": 4, "required_meeting_slots": [9]})
    match = find(client, class_id, assignment).json()["teams"][0]
    assert match["unknown_profiles"] == 0 and match["factors"]["common_meeting_slots"] == [9]
    assert "members" not in match and "profile" not in match
    assert client.post(f"/v1/teams/{team}/profile/withdraw", headers=hdr("alice"), json={"expected_version": 2}).status_code == 200
    assert client.post(f"/v1/teams/{team}/join-requests", headers=hdr("bob"), json={"match_snapshot": match["snapshot"]}).status_code == 409
    assert find(client, class_id, assignment).json()["teams"] == []


def test_unknown_members_fail_hard_constraints_and_membership_invalidates_match(world):
    client, _, ids, _ = world
    class_id, assignment, team = setup(client)
    publish(client, class_id, "bob", skills=["Design"], hours_per_week=5)
    team_publish(client, team, discovery=True, skills=["Python"], hours_per_week=5)
    match = find(client, class_id, assignment).json()["teams"][0]
    join(client, team, ids, "carol")
    assert client.get(f"/v1/teams/{team}/profile", headers=hdr("carol")).json()["published"] is False
    assert client.post(f"/v1/teams/{team}/join-requests", headers=hdr("bob"), json={"match_snapshot": match["snapshot"]}).status_code == 409
    current = find(client, class_id, assignment).json()["teams"][0]
    assert current["unknown_profiles"] == 1 and current["missing"]["commitment_count"] == 1
    client.put(f"/v1/classes/{class_id}/preferences", headers=hdr("bob"), json={"min_hours": 4})
    assert find(client, class_id, assignment).json()["teams"] == []
    client.put(f"/v1/classes/{class_id}/preferences", headers=hdr("bob"), json={})
    current = find(client, class_id, assignment).json()["teams"][0]
    request = client.post(f"/v1/teams/{team}/join-requests", headers=hdr("bob"), json={"match_snapshot": current["snapshot"]})
    assert request.status_code == 201
    assert client.post(f"/v1/teams/{team}/join-requests", headers=hdr("bob"), json={"match_snapshot": current["snapshot"]}).json()["id"] == request.json()["id"]


def test_removal_and_archival_clear_team_bodies_without_republishing(world):
    client, app, ids, _ = world
    class_id, _, team = setup(client)
    join(client, team, ids)
    team_publish(client, team, "bob", discovery=True, skills=["Design"])
    assert client.delete(f"/v1/teams/{team}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
    team_publish(client, team, discovery=True, skills=["Python"])
    assert client.post(f"/v1/classes/{class_id}/archive", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/restore", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/profile", headers=hdr("alice")).json()["published"] is False
    with app.state.sessions() as db:
        for who in ("alice", "bob"):
            row = db.get(TeamProfile, (team, ids[who]))
            assert json.loads(row.body_json) == {} and row.discovery is False and row.version == 2
        assert len(db.scalars(select(TeamConsentAudit).where(TeamConsentAudit.team_id == team)).all()) == 4


def test_withdrawal_scope_is_independent(world):
    client, _, _, _ = world
    class_id, _, team = setup(client)
    publish(client, class_id, "alice", skills=["Python"])
    team_publish(client, team, discovery=True, skills=["Python"])
    client.post(f"/v1/classes/{class_id}/profile/withdraw", headers=hdr("alice"), json={"expected_version": 1})
    assert client.get(f"/v1/teams/{team}/profile", headers=hdr("alice")).json()["published"] is True
    client.post(f"/v1/teams/{team}/profile/withdraw", headers=hdr("alice"), json={"expected_version": 1})
    assert client.get(f"/v1/teams/{team}/profiles", headers=hdr("alice")).json() == []


def test_project_archive_and_class_removal_clear_team_profiles(world):
    client, app, ids, _ = world
    class_id, _, team = setup(client)
    join(client, team, ids)
    team_publish(client, team, "bob", discovery=True, skills=["Design"])
    assert client.delete(f"/v1/classes/{class_id}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
    team_publish(client, team, discovery=True, skills=["Python"])
    assert client.post(f"/v1/teams/{team}/archive", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/teams/{team}/restore", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/teams/{team}/profiles", headers=hdr("alice")).json() == []
    with app.state.sessions() as db:
        assert db.get(TeamProfile, (team, ids["bob"])).published_at is None
