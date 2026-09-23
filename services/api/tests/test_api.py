import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"farq-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def test_fact_proposal_accept_and_reject_flow(client: TestClient):
    internal = {"X-Farq-Internal-Token": "farq-internal-dev"}
    demo = client.get("/api/demo").json()
    assert demo["student_id"] == "demo-student"

    fact = client.post("/internal/hermes/facts", headers=internal, json={
        "user_id": "demo-student",
        "category": "preference",
        "key": "career_direction",
        "value": "research",
        "source_message_id": "test-message",
        "explicit": True,
    })
    assert fact.status_code == 200
    context = client.get("/api/students/demo-student/context").json()
    assert context["facts"][0]["value"] == "research"

    roadmap = client.get("/api/students/demo-student/roadmap").json()
    proposal = client.post("/internal/hermes/roadmap-proposals", headers=internal, json={
        "user_id": "demo-student",
        "base_version_id": roadmap["version_id"],
        "summary": "Strengthen the research path",
        "reasoning": "The student explicitly selected research.",
        "operations": [{"type": "update_node", "node_id": "python-numpy", "changes": {"tagline": "Research-ready numerical foundations"}}],
    })
    assert proposal.status_code == 200
    accepted = client.post(f"/api/roadmap-proposals/{proposal.json()['proposal_id']}/accept")
    assert accepted.json()["version"] == 2
    current = client.get("/api/students/demo-student/roadmap").json()
    assert next(node for node in current["snapshot"]["nodes"] if node["id"] == "python-numpy")["tagline"] == "Research-ready numerical foundations"

    rejected_proposal = client.post("/internal/hermes/roadmap-proposals", headers=internal, json={
        "user_id": "demo-student",
        "base_version_id": current["version_id"],
        "summary": "A proposal to reject",
        "reasoning": "Verify rejection leaves the active version untouched.",
        "operations": [{"type": "update_node", "node_id": "linear-algebra", "changes": {"tagline": "Should not be applied"}}],
    }).json()
    assert client.post(f"/api/roadmap-proposals/{rejected_proposal['proposal_id']}/reject").json()["status"] == "rejected"
    assert client.get("/api/students/demo-student/roadmap").json()["version"] == 2


def test_completed_node_cannot_be_rewritten(client: TestClient):
    internal = {"X-Farq-Internal-Token": "farq-internal-dev"}
    client.put("/api/students/demo-student/roadmap/nodes/python-numpy", json={"status": "done"})
    roadmap = client.get("/api/students/demo-student/roadmap").json()
    response = client.post("/internal/hermes/roadmap-proposals", headers=internal, json={
        "user_id": "demo-student",
        "base_version_id": roadmap["version_id"],
        "summary": "Invalid history rewrite",
        "reasoning": "This should be rejected by the backend.",
        "operations": [{"type": "update_node", "node_id": "python-numpy", "changes": {"title": "Rewritten"}}],
    })
    assert response.status_code == 422
