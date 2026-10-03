"""CV Builder (app.cv): generation/assist schema validation + repair retry, ownership, confirmed-
only learner context, draft round-trip, and the isolated cv_fit purpose."""

import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-cv-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app import cv  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CoopCompany, CoopPosting, EvidenceItem, Student, StudentFact, StudentProfile  # noqa: E402

VALID_DOC = {
    "template": "modern",
    "theme": {"accent": "#0f766e", "font": "sans"},
    "contact": {"name": "Test Student", "headline": "CS Student"},
    "sections": [
        {"id": "sec-summary", "kind": "summary", "title": "Summary", "visible": True, "summary": "A capable student."},
        {
            "id": "sec-projects", "kind": "projects", "title": "Projects", "visible": True,
            "entries": [{
                "id": "ent-1", "title": "Waypoint", "subtitle": "", "location": "", "start": "2026", "end": "",
                "bullets": [{"id": "b-1", "text": "Built a thing", "provenance": {"label": "Evidence · reviewed certificate"}}],
            }],
        },
    ],
}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


@pytest.fixture
def student(client):
    """A fresh student with one confirmed fact, one confirmed evidence row, and one still-
    `suggested` evidence row that must never reach a prompt or a response."""
    db = SessionLocal()
    try:
        sid = f"cv-student-{uuid.uuid4().hex[:8]}"
        db.add(Student(id=sid, display_name="CV Test Student"))
        db.add(StudentProfile(student_id=sid, program="Computer Science", discipline="cs", year_label="Junior"))
        db.add(StudentFact(student_id=sid, category="skill", key="Python", value_json=json.dumps("Python"), source_kind="chat", active=True))
        db.add(EvidenceItem(student_id=sid, source_id="src-1", kind="certificate", title="AWS Cloud Practitioner",
                             data_json="{}", fingerprint="fp-confirmed", status="confirmed"))
        db.add(EvidenceItem(student_id=sid, source_id="src-1", kind="certificate", title="SECRET-NOT-REVIEWED-YET",
                             data_json="{}", fingerprint="fp-suggested", status="suggested"))
        db.commit()
        return sid
    finally:
        db.close()


@pytest.fixture
def posting(client):
    db = SessionLocal()
    try:
        db.merge(CoopCompany(slug="acme", name="Acme Corp"))
        item = CoopPosting(
            company_slug="acme", source="demo", external_id=f"job-{uuid.uuid4().hex[:8]}",
            title="Software Engineering Intern", description="Looking for Python and SQL skills.",
            extracted_json=json.dumps({
                "title": "Software Engineering Intern", "company": "Acme Corp", "disciplines": ["cs"],
                "seniority": "intern", "skill_requirements": [{"skill": "Python", "required": True}, {"skill": "Kubernetes", "required": True}],
                "eligibility_requirements": [],
            }),
            extraction_status="done",
        )
        db.add(item)
        db.commit()
        return item.id
    finally:
        db.close()


def hdr(student_id: str) -> dict:
    return {"X-Waypoint-User": student_id}


def test_context_never_includes_suggested_evidence(student):
    db = SessionLocal()
    try:
        context = cv.build_learner_context(db, student)
        block = cv.render_context_block(context)
    finally:
        db.close()
    assert "SECRET-NOT-REVIEWED-YET" not in block
    assert "AWS Cloud Practitioner" in block


def test_generate_validates_and_applies_contact_override(client, student, monkeypatch):
    monkeypatch.setattr(cv, "run_json_prompt", lambda *a, **k: json.dumps(VALID_DOC))
    response = client.post(f"/api/students/{student}/cv/generate", json={"contact": {"name": "Real Name", "email": "me@example.com"}})
    assert response.status_code == 200, response.text
    document = response.json()["document"]
    assert document["contact"]["name"] == "Real Name"
    assert document["contact"]["email"] == "me@example.com"
    # Draft was persisted.
    saved = client.get(f"/api/students/{student}/cv/draft", headers=hdr(student))
    assert saved.json()["document"]["contact"]["email"] == "me@example.com"


def test_generate_rejects_invented_provenance_and_repairs_once(client, student, monkeypatch):
    bad = {**VALID_DOC, "sections": [VALID_DOC["sections"][0], {
        **VALID_DOC["sections"][1],
        "entries": [{**VALID_DOC["sections"][1]["entries"][0], "bullets": [
            {"id": "b-1", "text": "Invented", "provenance": {"label": "Made up source"}},
        ]}],
    }]}
    calls = []

    def fake(kind, prompt, *a, **k):
        calls.append(prompt)
        return json.dumps(bad) if len(calls) == 1 else json.dumps(VALID_DOC)

    monkeypatch.setattr(cv, "run_json_prompt", fake)
    response = client.post(f"/api/students/{student}/cv/generate", json={}, headers=hdr(student))
    assert response.status_code == 200, response.text
    assert len(calls) == 2
    assert "rejected" in calls[1]


def test_generate_fails_after_two_bad_attempts(client, student, monkeypatch):
    monkeypatch.setattr(cv, "run_json_prompt", lambda *a, **k: "not json at all")
    response = client.post(f"/api/students/{student}/cv/generate", json={}, headers=hdr(student))
    assert response.status_code == 502


def test_draft_round_trip_and_ownership(client, student):
    put = client.put(f"/api/students/{student}/cv/draft", json={"document": VALID_DOC}, headers=hdr(student))
    assert put.status_code == 200, put.text
    got = client.get(f"/api/students/{student}/cv/draft", headers=hdr(student))
    assert got.json()["document"]["contact"]["name"] == "Test Student"

    other = f"other-{uuid.uuid4().hex[:8]}"
    db = SessionLocal()
    try:
        db.add(Student(id=other, display_name="Someone Else"))
        db.commit()
    finally:
        db.close()
    forbidden = client.get(f"/api/students/{student}/cv/draft", headers=hdr(other))
    assert forbidden.status_code == 403


def test_draft_rejects_invalid_document(client, student):
    broken = {**VALID_DOC, "sections": []}
    response = client.put(f"/api/students/{student}/cv/draft", json={"document": broken}, headers=hdr(student))
    assert response.status_code == 422


def test_assist_rejects_unknown_target_id(client, student, monkeypatch):
    monkeypatch.setattr(cv, "run_json_prompt", lambda *a, **k: json.dumps({
        "changes": [{"target_id": "summary:does-not-exist", "after": "x"}], "summary": "x", "reply": "x",
    }))
    response = client.post(f"/api/students/{student}/cv/assist", json={"instruction": "shorten it", "document": VALID_DOC}, headers=hdr(student))
    assert response.status_code == 502


def test_assist_applies_a_valid_bullet_edit(client, student, monkeypatch):
    monkeypatch.setattr(cv, "run_json_prompt", lambda *a, **k: json.dumps({
        "changes": [{"target_id": "bullet:sec-projects:ent-1:b-1", "after": "Engineered a thing"}],
        "summary": "Strengthened a bullet", "reply": "Strengthened one bullet with a stronger verb.",
    }))
    response = client.post(f"/api/students/{student}/cv/assist", json={"instruction": "stronger verbs", "document": VALID_DOC}, headers=hdr(student))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["document"]["sections"][1]["entries"][0]["bullets"][0]["text"] == "Engineered a thing"
    assert body["changes"][0]["before"] == "Built a thing"


def test_assist_caps_number_of_changes(client, student, monkeypatch):
    many = [{"target_id": "bullet:sec-projects:ent-1:b-1", "after": f"v{i}"} for i in range(6)]
    monkeypatch.setattr(cv, "run_json_prompt", lambda *a, **k: json.dumps({"changes": many, "summary": "x", "reply": "x"}))
    response = client.post(f"/api/students/{student}/cv/assist", json={"instruction": "x", "document": VALID_DOC}, headers=hdr(student))
    assert response.status_code == 502


def test_fit_scores_against_a_real_posting(client, student, posting):
    client.put(f"/api/students/{student}/cv/draft", json={"document": VALID_DOC}, headers=hdr(student))
    response = client.post(f"/api/students/{student}/cv/fit", json={"posting_id": posting}, headers=hdr(student))
    assert response.status_code == 200, response.text
    body = response.json()
    assert 0 <= body["score"] <= 100
    assert "Kubernetes" in [item["keyword"] for item in body["missing"]]


def test_fit_requires_existing_posting(client, student):
    response = client.post(f"/api/students/{student}/cv/fit", json={"posting_id": "nope", "document": VALID_DOC}, headers=hdr(student))
    assert response.status_code == 404
