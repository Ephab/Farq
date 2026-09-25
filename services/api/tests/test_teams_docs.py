from datetime import datetime, timedelta, timezone

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import DocSection


def _srs(client, world):
    response = client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "srs"}, headers=hdr(world["students"][0]))
    assert response.status_code == 201, response.text
    return response.json()


def _section(document, key):
    return next(section for section in document["sections"] if section["key"] == key)


def test_srs_document_gets_the_ieee_outline(client):
    world = make_world()
    document = _srs(client, world)
    assert document["title"] == "Software Requirements Specification"
    keys = [section["key"] for section in document["sections"]]
    assert keys[:3] == ["1", "1.1", "1.2"]
    assert "3.2" in keys
    assert {section["status"] for section in document["sections"]} == {"empty"}
    custom = client.post(f"/api/teams/{world['team_id']}/documents", json={"kind": "custom"}, headers=hdr(world["students"][0]))
    assert custom.status_code == 422


def test_section_lock_and_versioned_save(client):
    world = make_world()
    s0, s1 = world["students"][:2]
    section = _section(_srs(client, world), "3.2")
    base = f"/api/sections/{section['id']}"
    assert client.post(f"{base}/lock", headers=hdr(s0)).json()["lock_user_id"] == s0
    client.post(f"{base}/lock", headers=hdr(s0))
    assert [event["type"] for event in events_for(world["team_id"])].count("section.locked") == 1
    assert client.post(f"{base}/lock", headers=hdr(s1)).status_code == 409
    assert client.put(f"{base}/content", json={"content_md": "Mine", "version": 0}, headers=hdr(s1)).status_code == 409
    saved = client.put(f"{base}/content", json={"content_md": "FR-1 The system shall list found items.", "version": 0}, headers=hdr(s0))
    assert saved.status_code == 200, saved.text
    assert (saved.json()["version"], saved.json()["status"]) == (1, "accepted")
    assert client.put(f"{base}/content", json={"content_md": "Stale", "version": 0}, headers=hdr(s0)).status_code == 409
    assert client.post(f"{base}/unlock", headers=hdr(s1)).status_code == 403
    assert client.post(f"{base}/unlock", headers=hdr(s0)).status_code == 200
    assert client.post(f"{base}/lock", headers=hdr(s1)).status_code == 200


def test_expired_lock_can_be_taken_over(client):
    world = make_world()
    s0, s1 = world["students"][:2]
    section = _section(_srs(client, world), "1.1")
    client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s0))
    db = SessionLocal()
    try:
        # Naive, as SQLite returns it.
        db.get(DocSection, section["id"]).lock_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
        db.commit()
    finally:
        db.close()
    taken = client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s1))
    assert taken.status_code == 200, taken.text
    assert taken.json()["lock_user_id"] == s1


def test_section_owner_must_be_a_member(client):
    world = make_world()
    section = _section(_srs(client, world), "2.1")
    url = f"/api/sections/{section['id']}"
    assert client.patch(url, json={"owner_user_id": world["outsider"]}, headers=hdr(world["students"][0])).status_code == 422
    owned = client.patch(url, json={"owner_user_id": world["students"][1]}, headers=hdr(world["students"][0]))
    assert owned.json()["owner_user_id"] == world["students"][1]
    assert events_for(world["team_id"])[-1]["type"] == "section.updated"
