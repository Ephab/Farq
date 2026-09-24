import io
import json
import os
import tempfile
import uuid
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"farq-onboarding-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import StudentFact  # noqa: E402
from app.schemas import RoadmapSnapshot, validate_generated  # noqa: E402
from app.sources import SourceError  # noqa: E402
from app.sources.pdf_text import redact  # noqa: E402
from app.sources.web import fetch_page_text  # noqa: E402

INTERNAL = {"X-Farq-Internal-Token": "farq-internal-dev"}
HERMES = {"X-Hermes-Api-Key": "test-gateway-key-0123456789"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


class _Response:
    def __init__(self, payload, status_code=200, text=""):
        self._payload = payload
        self.status_code = status_code
        self.text = text or json.dumps(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def fake_gateway(outputs: list[str], prompts: list[str]):
    """A Hermes gateway that answers each run with the next canned output."""

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            prompts.append(json["input"])
            assert headers["X-Hermes-Session-Key"].startswith(("farq:ingest:", "farq:roadmap:"))
            return _Response({"run_id": f"run-{len(prompts)}"})

        def get(self, url, headers=None):
            return _Response({"status": "completed", "output": outputs[min(len(prompts), len(outputs)) - 1]})

    return FakeClient


def new_student(client: TestClient, name: str = "Test Student") -> dict:
    created = client.post("/api/students", json={"display_name": name})
    assert created.status_code == 201
    return created.json()


def test_new_student_starts_onboarding_with_empty_v0(client: TestClient):
    student = new_student(client)
    assert student["onboarding_status"] == "basics"
    roadmap = client.get(f"/api/students/{student['student_id']}/roadmap").json()
    assert roadmap["version"] == 0 and roadmap["snapshot"]["nodes"] == []
    # The pre-onboarding demo student counts as onboarded.
    assert client.get("/api/students/demo-student/profile").json()["onboarding_status"] == "done"


def test_profile_program_classifies_discipline(client: TestClient):
    sid = new_student(client)["student_id"]
    medicine = client.put(f"/api/students/{sid}/profile", json={"program": "Bachelor of Medicine (MBBS)", "institution": "Some University"}).json()
    assert medicine["discipline"] == "medicine"
    overridden = client.put(f"/api/students/{sid}/profile", json={"program": "Mechanical Engineering", "discipline": "law"}).json()
    assert overridden["discipline"] == "law"
    registry = client.get("/api/disciplines").json()
    assert {entry["id"] for entry in registry} >= {"cs", "engineering", "medicine", "law", "business"}


def test_source_values_are_validated(client: TestClient):
    sid = new_student(client)["student_id"]
    ok = client.post(f"/api/students/{sid}/sources", json={"kind": "github", "value": "https://github.com/some-user/"})
    assert ok.status_code == 201 and ok.json()["config"] == {"username": "some-user"}
    assert client.post(f"/api/students/{sid}/sources", json={"kind": "github", "value": "not a user!"}).status_code == 422
    assert client.post(f"/api/students/{sid}/sources", json={"kind": "portfolio_url", "value": "http://insecure.example"}).status_code == 422
    orcid = client.post(f"/api/students/{sid}/sources", json={"kind": "orcid", "value": "https://orcid.org/0000-0002-1825-0097"})
    assert orcid.json()["config"] == {"orcid": "0000-0002-1825-0097"}


def test_linkedin_zip_evidence_and_confirmation_become_facts(client: TestClient):
    sid = new_student(client)["student_id"]
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "linkedin_zip"}).json()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("Positions.csv", "Company Name,Title,Description,Location,Started On,Finished On\nAcme,AI Intern,Built models,,Jun 2025,Aug 2025\n")
        archive.writestr("Skills.csv", "Name\nPython\nPyTorch\n")
    upload = client.post(f"/api/students/{sid}/sources/{source['id']}/upload", files={"file": ("export.zip", buffer.getvalue(), "application/zip")})
    assert upload.status_code == 200, upload.text
    assert upload.json()["added"] == 3 and upload.json()["status"] == "ready"

    evidence = client.get(f"/api/students/{sid}/evidence").json()
    titles = {item["title"]: item for item in evidence}
    assert titles["AI Intern at Acme"]["status"] == "suggested"
    # Nothing becomes a fact until the student confirms it.
    assert client.get(f"/api/students/{sid}/context").json()["facts"] == []

    decision = client.post(f"/api/students/{sid}/evidence/decide", json={
        "confirm": [titles["Python"]["id"], titles["AI Intern at Acme"]["id"]],
        "dismiss": [titles["PyTorch"]["id"]],
    }).json()
    assert decision == {"confirmed": 2, "dismissed": 1}
    db = SessionLocal()
    facts = db.query(StudentFact).filter(StudentFact.student_id == sid, StudentFact.active.is_(True)).all()
    db.close()
    assert {fact.source_kind for fact in facts} == {"confirmed_evidence"}
    assert {fact.category for fact in facts} == {"skill", "achievement"}
    assert len(client.get(f"/api/students/{sid}/evidence").json()) == 2


def test_transcript_upload_redacts_and_extracts(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    sid = new_student(client)["student_id"]
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "transcript_pdf"}).json()
    monkeypatch.setattr("app.onboarding.extract_pdf_text", lambda data: redact("Student ID 2220001234 email a@b.com ARTI 309 Machine Learning A+ 3 " * 3))
    prompts: list[str] = []
    output = json.dumps({"items": [
        {"kind": "course", "title": "Machine Learning", "data": {"code": "ARTI 309", "grade": "A+", "credits": 3}},
        {"kind": "course", "title": "bad", "data": "not-an-object"},
    ]})
    monkeypatch.setattr("app.hermes.httpx.Client", fake_gateway([output], prompts))
    upload = client.post(f"/api/students/{sid}/sources/{source['id']}/upload", files={"file": ("t.pdf", b"%PDF-1.4", "application/pdf")}, headers=HERMES)
    assert upload.status_code == 200, upload.text
    assert upload.json()["added"] == 1
    assert "2220001234" not in prompts[0] and "a@b.com" not in prompts[0]
    assert "ARTI 309" in prompts[0]


def test_scanned_pdf_fails_with_clear_message(client: TestClient):
    sid = new_student(client)["student_id"]
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "cv_pdf"}).json()
    response = client.post(f"/api/students/{sid}/sources/{source['id']}/upload", files={"file": ("cv.txt", b"hello", "text/plain")})
    assert response.status_code == 422
    listed = client.get(f"/api/students/{sid}/sources").json()[0]
    assert listed["status"] == "failed" and "not a PDF" in listed["error"]


def test_hermes_folder_evidence_is_suggested_only(client: TestClient):
    sid = new_student(client)["student_id"]
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "folder", "value": "C:/work/projects", "purpose": "projects"}).json()
    submitted = client.post("/internal/hermes/evidence", headers=INTERNAL, json={
        "user_id": sid, "source_id": source["id"],
        "items": [
            {"kind": "project", "title": "vision-app", "data": {"url": "https://github.com/x/vision-app.git"}},
            {"kind": "project", "title": "Vision App copy", "data": {"url": "https://github.com/x/vision-app"}, "source_ref": "copy"},
        ],
    })
    assert submitted.json()["added"] == 1  # same remote -> merged
    other = new_student(client)["student_id"]
    wrong = client.post("/internal/hermes/evidence", headers=INTERNAL, json={"user_id": other, "source_id": source["id"], "items": [{"kind": "skill", "title": "x"}]})
    assert wrong.status_code == 404
    assert client.post("/internal/hermes/evidence", json={"user_id": sid, "source_id": source["id"], "items": [{"kind": "skill", "title": "x"}]}).status_code == 401


def generated_roadmap(done_evidence: str) -> dict:
    stages = [{"id": f"s{i}", "title": f"Stage {i}", "nodeIds": []} for i in range(1, 4)]
    nodes = []
    for i in range(12):
        stage = f"s{i // 4 + 1}"
        nodes.append({
            "id": f"n{i}", "stageId": stage, "title": f"Topic {i}", "icon": "stethoscope" if i else "not-an-icon",
            "deps": [f"n{i - 1}"] if i else [], "status": "done" if i < 2 else "not-started",
            "evidence": [done_evidence] if i == 0 else ["made-up-evidence"],
        })
    return {"title": "Clinical Roadmap", "stages": stages, "nodes": nodes}


def test_generate_preview_and_accept_initial_roadmap(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    sid = new_student(client)["student_id"]
    client.put(f"/api/students/{sid}/profile", json={"program": "Medicine", "onboarding_status": "chat"})
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "linkedin_zip"}).json()
    client.post("/internal/hermes/evidence", headers=INTERNAL, json={"user_id": sid, "source_id": source["id"], "items": [{"kind": "course", "title": "Anatomy", "data": {"code": "MED 101", "grade": "A"}}]})
    evidence_id = client.get(f"/api/students/{sid}/evidence").json()[0]["id"]
    client.post(f"/api/students/{sid}/evidence/decide", json={"confirm": [evidence_id]})

    prompts: list[str] = []
    cyclic = generated_roadmap(evidence_id)
    cyclic["nodes"][0]["deps"] = ["n11"]
    outputs = ["```json\n" + json.dumps(cyclic) + "\n```", "Here you go: " + json.dumps(generated_roadmap(evidence_id))]
    monkeypatch.setattr("app.hermes.httpx.Client", fake_gateway(outputs, prompts))

    proposal = client.post(f"/api/students/{sid}/onboarding/generate", json={}, headers=HERMES)
    assert proposal.status_code == 200, proposal.text
    body = proposal.json()
    assert len(prompts) == 2 and "rejected" in prompts[1]  # retried with the validation error
    assert "Anatomy" in prompts[0] and "preclinical" in prompts[0]
    nodes = {node["id"]: node for node in body["snapshot"]["nodes"]}
    assert nodes["n0"]["status"] == "done" and nodes["n0"]["evidence"] == [evidence_id]
    assert nodes["n1"]["status"] == "not-started" and nodes["n1"]["evidence"] == []  # no confirmed evidence
    assert nodes["n0"]["icon"] == "target"
    assert all(stage["nodeIds"] for stage in body["snapshot"]["stages"])
    assert client.get(f"/api/students/{sid}/profile").json()["onboarding_status"] == "preview"
    # Still not active until accepted.
    assert client.get(f"/api/students/{sid}/roadmap").json()["version"] == 0

    accepted = client.post(f"/api/roadmap-proposals/{body['id']}/accept", json={"not_done": ["n0"]})
    assert accepted.status_code == 200 and accepted.json()["version"] == 1
    active = client.get(f"/api/students/{sid}/roadmap").json()
    assert active["snapshot"]["title"] == "Clinical Roadmap"
    assert all(node["status"] == "not-started" for node in active["snapshot"]["nodes"])
    assert client.get(f"/api/students/{sid}/profile").json()["onboarding_status"] == "done"
    assert client.post(f"/api/students/{sid}/onboarding/generate", json={}).status_code == 409


def test_generation_failure_is_reported_not_faked(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    sid = new_student(client)["student_id"]
    client.put(f"/api/students/{sid}/profile", json={"onboarding_status": "chat"})
    monkeypatch.setattr("app.hermes.httpx.Client", fake_gateway(["not json at all"], []))
    response = client.post(f"/api/students/{sid}/onboarding/generate", json={}, headers=HERMES)
    assert response.status_code == 502
    assert client.get(f"/api/students/{sid}/profile").json()["onboarding_status"] == "chat"
    assert client.get(f"/api/students/{sid}/roadmap/proposals").json() == []


def test_validate_generated_requires_consistent_layout():
    snapshot = RoadmapSnapshot.model_validate({"stages": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}], "nodes": [
        {"id": f"n{i}", "stageId": "a", "title": "x"} for i in range(4)
    ]})
    with pytest.raises(ValueError, match="no nodes"):
        validate_generated(snapshot, set())


@pytest.mark.parametrize("url", ["http://example.com", "https://127.0.0.1/", "https://localhost/", "https://10.0.0.5/admin"])
def test_portfolio_fetch_rejects_private_or_insecure_urls(url: str):
    with pytest.raises(SourceError):
        fetch_page_text(url)
