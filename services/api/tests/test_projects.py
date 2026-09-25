import os
import io
import tempfile
import uuid
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"farq-projects-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


INTERNAL = {"X-Farq-Internal-Token": "farq-internal-dev"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def test_demo_roadmap_projects_are_materialized(client: TestClient):
    response = client.get("/api/students/demo-student/projects")
    assert response.status_code == 200, response.text
    projects = response.json()
    assert {item["roadmap_node_id"] for item in projects} >= {"project-realtime", "project-multimodal"}
    assert all(item["brief"]["rubric"] for item in projects)
    assert all(sum(criterion["weight"] for criterion in item["brief"]["rubric"]) == 100 for item in projects)


def test_project_refinement_requires_explicit_accept(client: TestClient):
    project = client.get("/api/students/demo-student/projects").json()[0]
    old_title = project["title"]
    brief = {
        **project["brief"],
        "title": "A project I actually want to build",
        "objective": "Create a concrete artifact for a real audience.",
    }
    created = client.post(f"/api/projects/{project['id']}/refinements", json={"brief": brief, "source": "student"})
    assert created.status_code == 200, created.text
    assert client.get(f"/api/projects/{project['id']}").json()["title"] == old_title

    accepted = client.post(f"/api/projects/{project['id']}/refinements/{created.json()['id']}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["title"] == brief["title"]
    assert accepted.json()["draft_revisions"] == []


def test_evaluation_contract_scores_and_completes_node(client: TestClient):
    project = client.get("/api/students/demo-student/projects").json()[0]
    bad = client.post(f"/api/projects/{project['id']}/submissions", json={"source_type": "github", "source_ref": "http://localhost/private", "manifest": {}})
    assert bad.status_code == 422

    submitted = client.post(f"/api/projects/{project['id']}/submissions", json={"source_type": "github", "source_ref": "https://github.com/example/project", "manifest": {}})
    assert submitted.status_code == 200, submitted.text
    evaluation = client.post(f"/api/projects/{project['id']}/evaluations", json={"submission_id": submitted.json()["id"]})
    assert evaluation.status_code == 200
    claimed = client.post("/internal/evaluator/jobs/claim", json={}, headers=INTERNAL).json()["job"]
    assert claimed["id"] == evaluation.json()["id"]

    completed = client.post(f"/internal/evaluator/jobs/{claimed['id']}/complete", headers=INTERNAL, json={
        "lease_token": claimed["lease_token"], "adapter": "software", "score": 74, "coverage": "high",
        "criteria": [{"criterion_id": item["id"], "score": 74, "evidence": ["real test output"], "feedback": "Verified in the sandbox."} for item in project["brief"]["rubric"]],
        "strengths": ["Working artifact"], "improvements": ["Add edge-case tests"], "limitations": [], "summary": "The submitted artifact was built and tested.",
    })
    assert completed.status_code == 200, completed.text
    updated = client.get(f"/api/projects/{project['id']}").json()
    assert updated["latest_score"] == 74
    assert updated["best_score"] == 74
    roadmap = client.get("/api/students/demo-student/roadmap").json()["snapshot"]
    node = next(item for item in roadmap["nodes"] if item["id"] == project["roadmap_node_id"])
    assert node["status"] == "done"


def test_zip_submission_is_validated_and_available_to_worker(client: TestClient):
    project = client.get("/api/students/demo-student/projects").json()[0]
    invalid = client.post(f"/api/projects/{project['id']}/submissions/upload", files={"file": ("fake.zip", b"not a zip", "application/zip")})
    assert invalid.status_code == 422
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("README.md", "# Real project")
    uploaded = client.post(f"/api/projects/{project['id']}/submissions/upload", files={"file": ("project.zip", buffer.getvalue(), "application/zip")})
    assert uploaded.status_code == 200, uploaded.text
    downloaded = client.get(f"/internal/evaluator/submissions/{uploaded.json()['id']}/archive", headers=INTERNAL)
    assert downloaded.status_code == 200
    assert downloaded.content.startswith(b"PK")


def test_skill_sequence_requires_a_final_project():
    from app.schemas import RoadmapNode, validate_stage_nodes

    learning = RoadmapNode(id="learn", stageId="applied", title="Learn", nodeType="learning")
    with pytest.raises(ValueError, match="exactly one project"):
        validate_stage_nodes([learning, RoadmapNode(id="practice", stageId="applied", title="Practice")], "applied", set(), set(), "skill_sequence")
    project = RoadmapNode(id="ship", stageId="applied", title="Ship", nodeType="project", deps=["learn"])
    assert validate_stage_nodes([learning, project], "applied", set(), set(), "skill_sequence")[-1].nodeType == "project"
