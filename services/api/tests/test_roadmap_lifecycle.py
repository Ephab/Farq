"""Remove (archive), history and restore for a student's roadmap, and the rule that generating a
replacement is still a Hermes `initial` proposal that only the accept endpoint activates."""
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-lifecycle-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import RoadmapProposal, RoadmapVersion, StudentProfile  # noqa: E402
from app.schemas import RoadmapNode, RoadmapSnapshot, RoadmapStage  # noqa: E402

NO_AUTO = {"X-Test-No-Auto": "1"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def student_with_roadmap(client: TestClient, name: str = "Lifecycle") -> str:
    sid = client.post("/api/students", json={"display_name": name}).json()["student_id"]
    snapshot = RoadmapSnapshot(
        title="Vision",
        stages=[RoadmapStage(id="one", title="One", nodeIds=["a", "b"])],
        nodes=[RoadmapNode(id="a", stageId="one", title="A", status="done"), RoadmapNode(id="b", stageId="one", title="B", deps=["a"])],
    )
    db = SessionLocal()
    try:
        current = db.query(RoadmapVersion).filter_by(student_id=sid, active=True).one()
        current.active = False
        db.add(RoadmapVersion(student_id=sid, version=1, snapshot_json=snapshot.model_dump_json(), reason="Seeded", active=True))
        db.commit()
    finally:
        db.close()
    return sid


def test_archive_keeps_history_and_empties_the_active_roadmap(client: TestClient):
    sid = student_with_roadmap(client)
    archived = client.post(f"/api/students/{sid}/roadmap/archive")
    assert archived.status_code == 200 and archived.json()["version"] == 2
    assert client.get(f"/api/students/{sid}/roadmap").json()["snapshot"]["nodes"] == []
    versions = client.get(f"/api/students/{sid}/roadmap/versions").json()
    assert [(item["version"], item["active"], item["nodes"]) for item in versions] == [(2, True, 0), (1, False, 2), (0, False, 0)]
    assert versions[1]["done"] == 1
    old = client.get(f"/api/students/{sid}/roadmap/versions/{versions[1]['id']}").json()
    assert [node["id"] for node in old["snapshot"]["nodes"]] == ["a", "b"]
    # Nothing left to remove.
    assert client.post(f"/api/students/{sid}/roadmap/archive").status_code == 409


def test_archive_retires_pending_proposals_and_restore_brings_progress_back(client: TestClient):
    sid = student_with_roadmap(client, "Restore")
    base = client.get(f"/api/students/{sid}/roadmap").json()["version_id"]
    db = SessionLocal()
    try:
        proposal = RoadmapProposal(student_id=sid, base_version_id=base, summary="Add C", reasoning="because", operations_json="[]")
        db.add(proposal)
        db.commit()
        proposal_id = proposal.id
    finally:
        db.close()
    client.post(f"/api/students/{sid}/roadmap/archive")
    assert client.get(f"/api/roadmap-proposals/{proposal_id}").json()["status"] == "rejected"
    # The stale proposal can no longer be accepted.
    assert client.post(f"/api/roadmap-proposals/{proposal_id}/accept").status_code == 409
    first = next(item for item in client.get(f"/api/students/{sid}/roadmap/versions").json() if item["version"] == 1)
    restored = client.post(f"/api/students/{sid}/roadmap/versions/{first['id']}/restore")
    assert restored.status_code == 200 and restored.json()["version"] == 3
    active = client.get(f"/api/students/{sid}/roadmap").json()
    assert {node["id"]: node["status"] for node in active["snapshot"]["nodes"]} == {"a": "done", "b": "not-started"}
    assert active["reason"] == "Restored version 1"
    # Restoring an empty version, or the one already active, is refused.
    versions = client.get(f"/api/students/{sid}/roadmap/versions").json()
    empty = next(item for item in versions if item["nodes"] == 0)
    assert client.post(f"/api/students/{sid}/roadmap/versions/{empty['id']}/restore").status_code == 409
    assert client.post(f"/api/students/{sid}/roadmap/versions/{active['version_id']}/restore").status_code == 409


def test_lifecycle_routes_are_owner_only(client: TestClient):
    mine = student_with_roadmap(client, "Mine")
    other = client.post("/api/students", json={"display_name": "Other"}).json()["student_id"]
    version = client.get(f"/api/students/{mine}/roadmap/versions").json()[0]["id"]
    as_other = {**NO_AUTO, "X-Waypoint-User": other}
    for method, path in (
        ("get", f"/api/students/{mine}/roadmap/versions"),
        ("get", f"/api/students/{mine}/roadmap/versions/{version}"),
        ("post", f"/api/students/{mine}/roadmap/archive"),
        ("post", f"/api/students/{mine}/roadmap/versions/{version}/restore"),
    ):
        assert getattr(client, method)(path, headers=as_other).status_code == 403
        assert getattr(client, method)(path, headers=NO_AUTO).status_code == 401
    # A version id from another student's history is not reachable through your own path.
    theirs = client.get(f"/api/students/{other}/roadmap/versions").json()[0]["id"]
    assert client.get(f"/api/students/{mine}/roadmap/versions/{theirs}").status_code == 404
    assert len(client.get(f"/api/students/{mine}/roadmap/versions").json()) == 2


def test_replacement_generation_requires_archive_and_stays_a_proposal(client: TestClient):
    sid = student_with_roadmap(client, "Regenerate")
    # With a roadmap in place the generator refuses: no silent replacement.
    assert client.post(f"/api/students/{sid}/onboarding/generate", json={}).status_code == 409
    client.post(f"/api/students/{sid}/roadmap/archive")
    # Archiving does not touch onboarding state, so the student stays in the app.
    assert client.get(f"/api/students/{sid}/profile").json()["onboarding_status"] != "generating"


def test_generate_after_archive_is_a_pending_initial_proposal_and_stays_in_the_app(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    import json

    from test_onboarding import HERMES, INTERNAL, fake_gateway, generated_roadmap

    sid = student_with_roadmap(client, "Fresh start")
    client.put(f"/api/students/{sid}/profile", json={"program": "Medicine"})
    db = SessionLocal()
    try:
        db.get(StudentProfile, sid).onboarding_status = "done"
        db.commit()
    finally:
        db.close()
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "folder", "value": "C:/work/courses", "purpose": "coursework"}).json()
    client.post("/internal/hermes/evidence", headers=INTERNAL, json={"user_id": sid, "source_id": source["id"], "items": [{"kind": "course", "title": "Anatomy"}]})
    evidence_id = client.get(f"/api/students/{sid}/evidence").json()[0]["id"]
    client.post(f"/api/students/{sid}/evidence/decide", json={"confirm": [evidence_id]})
    monkeypatch.setattr("app.hermes.httpx.Client", fake_gateway([json.dumps(generated_roadmap(evidence_id))], []))

    client.post(f"/api/students/{sid}/roadmap/archive")
    proposal = client.post(f"/api/students/{sid}/onboarding/generate", json={}, headers=HERMES)
    assert proposal.status_code == 200, proposal.text
    assert proposal.json()["kind"] == "initial" and proposal.json()["status"] == "pending"
    # Not active until the student accepts, and onboarding is not restarted.
    assert client.get(f"/api/students/{sid}/roadmap").json()["snapshot"]["nodes"] == []
    assert client.get(f"/api/students/{sid}/profile").json()["onboarding_status"] == "done"
    accepted = client.post(f"/api/roadmap-proposals/{proposal.json()['id']}/accept", json={"not_done": []})
    assert accepted.status_code == 200 and accepted.json()["version"] == 3
