from sqlalchemy import select
from test_team_port import world, hdr
from test_openings import setup
from collaboration.profiles import SharedProfile, ConsentAudit
from collaboration.matching import fit


def publish(client, class_id, who, **fields):
    response = client.put(f"/v1/classes/{class_id}/profile", headers=hdr(who), json={"reviewed": True, "expected_version": 0, "profile": {"looking": True, **fields}})
    assert response.status_code == 200
    return response.json()


def test_publication_requires_review_and_strict_fields_and_version(world):
    client, _, _, _ = world
    class_id, _, _ = setup(client)
    url = f"/v1/classes/{class_id}/profile"
    assert client.put(url, headers=hdr("bob"), json={"expected_version": 0, "profile": {}}).status_code == 422
    assert client.put(url, headers=hdr("bob"), json={"reviewed": False, "expected_version": 0, "profile": {}}).status_code == 422
    assert client.put(url, headers=hdr("bob"), json={"reviewed": True, "expected_version": 0, "profile": {"mail": "private"}}).status_code == 422
    publish(client, class_id, "bob", skills=["Python", "Python"])
    assert client.get(url, headers=hdr("bob")).json()["profile"]["skills"] == ["Python"]
    assert client.put(url, headers=hdr("bob"), json={"reviewed": True, "expected_version": 0, "profile": {}}).status_code == 409
    assert client.get(url, headers=hdr("outsider")).status_code == 404


def test_withdrawal_removes_body_and_reauthorizes_cached_versions(world):
    client, app, ids, _ = world
    class_id, _, _ = setup(client)
    publish(client, class_id, "carol")
    profile = publish(client, class_id, "bob", skills=["Design"])
    candidate = f"/v1/classes/{class_id}/profiles/{ids['bob']}?version={profile['version']}"
    assert client.get(candidate, headers=hdr("carol")).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/profile/withdraw", headers=hdr("bob"), json={"expected_version": profile["version"]}).status_code == 200
    assert client.get(candidate, headers=hdr("carol")).status_code == 404
    with app.state.sessions() as db:
        row = db.get(SharedProfile, (class_id, ids["bob"]))
        assert row.body_json == "{}" and row.published_at is None and row.version == 2
        audit = db.scalars(select(ConsentAudit).where(ConsentAudit.account_id == ids["bob"])).all()
        assert [row.action for row in audit] == ["publish", "withdraw"]
        assert not hasattr(audit[0], "body_json")


def test_membership_end_and_archive_do_not_republish_profiles(world):
    client, _, ids, _ = world
    class_id, _, _ = setup(client)
    publish(client, class_id, "bob")
    publish(client, class_id, "carol")
    assert client.delete(f"/v1/classes/{class_id}/members/{ids['bob']}", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/archive", headers=hdr("alice")).status_code == 200
    assert client.post(f"/v1/classes/{class_id}/restore", headers=hdr("alice")).status_code == 200
    assert client.get(f"/v1/classes/{class_id}/profile", headers=hdr("carol")).json()["published"] is False


def test_matching_consent_assignment_and_hard_constraints(world):
    client, _, _, _ = world
    class_id, assignment, team = setup(client)
    publish(client, class_id, "alice", skills=["Python"])
    publish(client, class_id, "bob", skills=["Python"], languages=["English"], hours_per_week=5)
    publish(client, class_id, "carol", skills=["Design"], languages=["English"], hours_per_week=5)
    endpoint = f"/v1/classes/{class_id}/discovery/matches"
    assert client.post(endpoint, headers=hdr("alice"), json={"assignment_id": assignment}).status_code == 409
    assert client.post(endpoint, headers=hdr("outsider"), json={"assignment_id": assignment}).status_code == 404
    assert client.put(f"/v1/classes/{class_id}/preferences", headers=hdr("bob"), json={"team_size": 2, "required_skills": ["Design"], "required_languages": ["English"], "min_hours": 4}).status_code == 200
    result = client.post(endpoint, headers=hdr("bob"), json={"assignment_id": assignment}).json()
    assert len(result["teams"]) == 1 and result["eligible_candidates"] == 1
    assert result["teams"][0]["factors"]["complementary_skills"] == ["design"]
    assert result["teams"][0]["missing"]["schedule_count"] == 2
    assert client.get(f"/v1/classes/{class_id}/preferences", headers=hdr("carol")).json()["required_skills"] == []
    assert client.post(f"/v1/classes/{class_id}/profile/withdraw", headers=hdr("carol"), json={"expected_version": 1}).status_code == 200
    assert client.post(endpoint, headers=hdr("bob"), json={"assignment_id": assignment}).json()["teams"] == []


def test_fit_rejects_unknown_or_incompatible_hard_requirements():
    base = {"skills": ["Python"], "languages": ["English"], "hours_per_week": 5, "meeting_slots": [9]}
    designer = {"skills": ["Design"], "languages": ["English"], "hours_per_week": 5, "meeting_slots": [9]}
    preferences = {"required_skills": ["Python", "Design"], "min_hours": 4, "required_meeting_slots": [9]}
    assert fit([base, designer], preferences)["factors"]["common_meeting_slots"] == [9]
    assert fit([base, {**designer, "meeting_slots": [10]}], preferences) is None
    assert fit([base, {**designer, "hours_per_week": None}], preferences) is None
    assert fit([base, base], preferences) is None


def test_whole_team_complementarity_and_matching_quota(world):
    client, _, ids, _ = world
    class_id, _, _ = setup(client)
    assignment = client.post(f"/v1/classes/{class_id}/assignments", headers=hdr("alice"), json={"title": "New project"}).json()["id"]
    publish(client, class_id, "alice", skills=["Python"], meeting_slots=[9])
    publish(client, class_id, "bob", skills=["Testing"], meeting_slots=[9])
    publish(client, class_id, "carol", skills=["Design"], meeting_slots=[9])
    client.put(f"/v1/classes/{class_id}/preferences", headers=hdr("alice"), json={"team_size": 3, "required_skills": ["Testing", "Design"], "required_meeting_slots": [9]})
    endpoint = f"/v1/classes/{class_id}/discovery/matches"
    for _ in range(20):
        response = client.post(endpoint, headers=hdr("alice"), json={"assignment_id": assignment})
        assert response.status_code == 200
    team = response.json()["teams"][0]
    assert {member["account_id"] for member in team["members"]} == {ids["bob"], ids["carol"]}
    assert team["factors"]["common_meeting_slots"] == [9]
    assert client.post(endpoint, headers=hdr("alice"), json={"assignment_id": assignment}).status_code == 429
