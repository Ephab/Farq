"""Phase B: structured extraction, per-student Jev relevance, and gap-to-roadmap proposals.

External calls are always monkeypatched here — these tests must be deterministic and never touch
a real Gemini/Jev/Apify endpoint, independent of whatever keys a developer's shell happens to have.
"""

import hashlib
import json
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-coop-phaseb-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app import coop_extraction, coop_relevance, decision_engines  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CoopCompany, CoopPosting, RoadmapProposal, RoadmapVersion, StudentFact  # noqa: E402
from app.schemas import RoadmapSnapshot  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


@pytest.fixture(scope="module", autouse=True)
def _tables():
    """Unit tests below that never start the app still need the schema."""
    from app.database import Base
    Base.metadata.create_all(engine)


@pytest.fixture(autouse=True)
def _no_live_decision_engines(monkeypatch):
    """Force the Jev -> Span -> Laya chain unavailable for every test in this module (even Laya,
    which can be a real local model already loaded on a dev machine and would otherwise make these
    tests slow and environment-dependent). coop_relevance's discipline-aware fallback is exactly
    what should run instead — see test_jev_down_fallback_still_separates_relevant_from_irrelevant."""
    def _raise(*_args, **_kwargs):
        raise decision_engines.EngineUnavailable("jev:disabled_for_tests,span:disabled_for_tests,laya:disabled_for_tests")
    monkeypatch.setattr(decision_engines, "ask_chain", _raise)
    # In the app the request never waits on a model (budgets are 0; a background pass scores). Here
    # the request scores everything itself, so one GET shows the scored result deterministically.
    from app import coop
    monkeypatch.setattr(coop, "EXTRACTION_BUDGET_PER_REQUEST", 30)
    monkeypatch.setattr(coop, "RELEVANCE_BUDGET_PER_REQUEST", 30)


def _new_student(client: TestClient, name: str) -> str:
    return client.post("/api/students", json={"display_name": name}).json()["student_id"]


def _give_roadmap(student_id: str) -> None:
    """Student creation already seeds an empty active roadmap (onboarding default); give it a
    stage to attach gap nodes to instead of inserting a second active version (unique index)."""
    db = SessionLocal()
    snapshot = RoadmapSnapshot(title="Roadmap", stages=[{"id": "s1", "title": "Stage 1", "nodeIds": [], "stageType": "career"}], nodes=[])
    current = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    if current is None:
        db.add(RoadmapVersion(student_id=student_id, version=1, snapshot_json=snapshot.model_dump_json(), active=True))
    else:
        current.snapshot_json = snapshot.model_dump_json()
    db.commit()
    db.close()


def _set_profile(client: TestClient, student_id: str, discipline: str, program: str) -> None:
    response = client.put(f"/api/students/{student_id}/profile", json={"discipline": discipline, "program": program})
    assert response.status_code == 200


def _add_skill(student_id: str, key: str) -> None:
    db = SessionLocal()
    db.add(StudentFact(student_id=student_id, category="skill", key=key, value_json=json.dumps(key), source_kind="onboarding"))
    db.commit()
    db.close()


def _real_posting(company_slug: str, external_id: str, title: str, description: str, location: str = "Riyadh") -> str:
    db = SessionLocal()
    if db.get(CoopCompany, company_slug) is None:
        db.add(CoopCompany(slug=company_slug, name=company_slug.title(), skills_json="[]"))
        db.flush()
    payload = json.dumps([external_id, title], sort_keys=True)
    posting = CoopPosting(
        company_slug=company_slug, source="telegram", external_id=external_id, title=title,
        description=description, location=location, is_demo=False, active=True,
        raw_hash=hashlib.sha256(payload.encode()).hexdigest(), canonical_key=hashlib.sha256((title + external_id).encode()).hexdigest(),
    )
    db.add(posting)
    db.commit()
    posting_id = posting.id
    db.close()
    return posting_id


# --- Extraction ---------------------------------------------------------------------------------

ARAMCO_EXTRACTION = {
    "title": "Cooperative Training Program", "company": "Aramco",
    "disciplines": ["engineering", "business"], "seniority": "co_op",
    "skill_requirements": [],
    "eligibility_requirements": [
        {"type": "nationality", "detail": "Saudi national", "learnable": False},
        {"type": "gpa", "detail": "GPA 2.0/4.0 minimum", "learnable": False},
        {"type": "language_test", "detail": "English placement test", "learnable": True},
        {"type": "university_letter", "detail": "University cooperative-training letter", "learnable": False},
    ],
    "location": "Dhahran", "duration": "8-15 weeks",
    "apply_opens_at": "2026-10-26T08:00:00", "apply_closes_at": "2026-11-02T15:00:00",
}


def test_extraction_never_invents_a_skill_for_an_eligibility_only_posting(monkeypatch):
    monkeypatch.setattr(coop_extraction, "run_json_prompt", lambda *a, **k: json.dumps(ARAMCO_EXTRACTION))
    posting = CoopPosting(company_slug="aramco", source="telegram", external_id="aramco-1", title="راو", description="raw arabic text")
    result = coop_extraction.extract_posting_text(posting)
    assert result is not None
    assert result["skill_requirements"] == []
    assert {item["type"] for item in result["eligibility_requirements"]} == {"nationality", "gpa", "language_test", "university_letter"}
    assert result["apply_opens_at"] == "2026-10-26T08:00:00"
    assert result["apply_closes_at"] == "2026-11-02T15:00:00"


def test_ensure_extracted_runs_once_and_is_cached(monkeypatch):
    calls = {"n": 0}

    def fake_run(*args, **kwargs):
        calls["n"] += 1
        return json.dumps(ARAMCO_EXTRACTION)

    monkeypatch.setattr(coop_extraction, "run_json_prompt", fake_run)
    db = SessionLocal()
    posting = CoopPosting(company_slug="aramco", source="telegram", external_id="aramco-2", title="x", description="y")
    db.add(posting)
    db.commit()
    coop_extraction.ensure_extracted(db, [posting], max_new=4)
    assert calls["n"] == 1
    assert posting.extraction_status == "done"
    coop_extraction.ensure_extracted(db, [posting], max_new=4)
    assert calls["n"] == 1  # second pass is a no-op: status is already "done"
    db.close()


def test_demo_posting_is_never_sent_to_a_model(monkeypatch):
    monkeypatch.setattr(coop_extraction, "run_json_prompt", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not call the model for demo data")))
    db = SessionLocal()
    posting = CoopPosting(company_slug="aramco", source="demo", external_id="demo-x", title="x", description="y", is_demo=True)
    db.add(posting)
    db.commit()
    coop_extraction.ensure_extracted(db, [posting], max_new=4)
    assert posting.extraction_status == "skipped"
    db.close()


# --- Relevance: discipline-aware fallback (no engine configured in tests) -----------------------

def test_jev_down_fallback_still_separates_relevant_from_irrelevant():
    # No engine is configured in the test environment (no API keys, Laya never loaded), so the
    # whole chain is unavailable and compute_relevance must fall back deterministically.
    with pytest.raises(decision_engines.EngineUnavailable):
        decision_engines.ask_chain("{}", coop_relevance.RELEVANCE_QUESTIONS)

    cs_relevant, cs_score, engine = coop_relevance._fallback_decision(
        "cs", {"disciplines": ["cs"], "seniority": "co_op"}, matched=["python"], total_requirements=2,
    )
    assert engine == "fallback" and cs_relevant and cs_score > 50

    manager_relevant, manager_score, _ = coop_relevance._fallback_decision(
        "cs", {"disciplines": ["cs"], "seniority": "manager"}, matched=["python"], total_requirements=2,
    )
    assert not manager_relevant and manager_score <= 10

    mismatch_relevant, _, _ = coop_relevance._fallback_decision(
        "medicine", {"disciplines": ["cs"], "seniority": "co_op"}, matched=[], total_requirements=2,
    )
    assert not mismatch_relevant


def test_cs_and_medicine_students_get_different_visible_and_hidden_sets(client: TestClient, monkeypatch):
    monkeypatch.setattr(coop_extraction, "run_json_prompt", lambda *a, **k: json.dumps({
        "title": "AI/ML Co-op Engineer", "company": "SDAIA", "disciplines": ["cs"], "seniority": "co_op",
        "skill_requirements": [{"skill": "Python", "quote": "Python required", "required": True},
                                {"skill": "Docker", "quote": "deployment with Docker", "required": False}],
        "eligibility_requirements": [], "location": "Riyadh", "duration": "12 weeks",
        "apply_opens_at": None, "apply_closes_at": None,
    }))
    ai_posting_id = _real_posting("sdaia-test", "sdaia-ai-1", "AI/ML Co-op Engineer", "Build ML pipelines in Python with Docker.")

    cs_student = _new_student(client, "CS Student")
    _set_profile(client, cs_student, "cs", "Computer Science")
    _add_skill(cs_student, "python")

    med_student = _new_student(client, "Medicine Student")
    _set_profile(client, med_student, "medicine", "Medicine")

    cs_matches = client.get(f"/api/students/{cs_student}/coop/matches").json()
    med_matches = client.get(f"/api/students/{med_student}/coop/matches").json()

    cs_ids = {item["id"] for item in cs_matches["visible"]}
    med_ids = {item["id"] for item in med_matches["visible"]}
    assert ai_posting_id in cs_ids
    assert ai_posting_id not in med_ids
    assert any(item["id"] == ai_posting_id for item in med_matches["hidden"])
    cs_item = next(item for item in cs_matches["visible"] if item["id"] == ai_posting_id)
    assert "python" in cs_item["reasons"][0].lower() or "python" in " ".join(cs_item["matched_skills"]).lower()
    assert any(gap["skill"].lower() == "docker" for gap in cs_item["coop_gaps"])


def test_eligibility_only_posting_yields_no_skill_gaps_but_an_eligibility_checklist(client: TestClient, monkeypatch):
    monkeypatch.setattr(coop_extraction, "run_json_prompt", lambda *a, **k: json.dumps(ARAMCO_EXTRACTION))
    posting_id = _real_posting("aramco-test", "aramco-coop-1", "Aramco Cooperative Training", "Eligibility-only Arabic posting.", location="Dhahran")
    student = _new_student(client, "Eligibility Student")
    _set_profile(client, student, "engineering", "Mechanical Engineering")

    result = client.get(f"/api/students/{student}/coop/matches").json()
    item = next((i for i in result["visible"] + result["hidden"] if i["id"] == posting_id), None)
    assert item is not None
    skill_gaps = [gap for gap in item["coop_gaps"] if gap["skill"] != "Language proficiency test prep"]
    assert skill_gaps == []
    assert any(gap["skill"] == "Language proficiency test prep" for gap in item["coop_gaps"])
    checklist_types = {entry["type"] for entry in item["eligibility"]}
    assert checklist_types == {"nationality", "gpa", "university_letter"}


# --- Gap -> roadmap proposal ----------------------------------------------------------------------

def test_propose_gaps_creates_one_pending_proposal_and_activates_nothing(client: TestClient, monkeypatch):
    monkeypatch.setattr(coop_extraction, "run_json_prompt", lambda *a, **k: json.dumps({
        "title": "Platform Engineering Co-op", "company": "stc", "disciplines": ["cs"], "seniority": "co_op",
        "skill_requirements": [{"skill": "Bash", "quote": "shell scripting required", "required": True},
                                {"skill": "Kubernetes", "quote": "k8s preferred", "required": False}],
        "eligibility_requirements": [], "location": "Riyadh", "duration": "12 weeks",
        "apply_opens_at": None, "apply_closes_at": None,
    }))
    posting_id = _real_posting("stc-test", "stc-cloud-1", "Platform Engineering Co-op", "Shell scripting and k8s.")
    student = _new_student(client, "Proposal Student")
    _set_profile(client, student, "cs", "Computer Science")
    _give_roadmap(student)

    before = client.get(f"/api/students/{student}/coop/matches").json()
    item = next(i for i in before["visible"] + before["hidden"] if i["id"] == posting_id)
    assert len(item["coop_gaps"]) == 2

    response = client.post(f"/api/students/{student}/coop/postings/{posting_id}/propose-gaps", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["node_count"] == 2

    db = SessionLocal()
    proposal = db.get(RoadmapProposal, body["proposal_id"])
    assert proposal is not None
    assert proposal.status == "pending"
    assert proposal.kind == "coop_gaps"
    current = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student, RoadmapVersion.active.is_(True)))
    db.close()
    # The active roadmap version is unchanged until the student accepts the proposal.
    snapshot = RoadmapSnapshot.model_validate_json(current.snapshot_json)
    assert snapshot.nodes == []


def test_propose_gaps_rejects_cross_student_access(client: TestClient):
    owner = _new_student(client, "Owner")
    intruder = _new_student(client, "Intruder")
    _set_profile(client, owner, "cs", "Computer Science")
    _give_roadmap(owner)
    response = client.post(
        f"/api/students/{owner}/coop/postings/does-not-matter/propose-gaps",
        json={}, headers={"X-Waypoint-User": intruder},
    )
    assert response.status_code in (403, 404)


def test_discipline_guard_hides_mismatch_caps_adjacent_and_broad_programs():
    guard = coop_relevance._discipline_guard
    # Targets majors that exclude the student and nothing matched: hidden even if the engine said yes.
    assert guard("cs", {"disciplines": ["business", "law"]}, [], True, 95) == (False, 15)
    # Adjacent major stays visible but can't read as a top match on discipline alone.
    assert guard("cs", {"disciplines": ["engineering"]}, [], True, 95) == (True, 60)
    # A broad "every major, soft skills only" program is capped.
    assert guard("cs", {"disciplines": ["business", "engineering", "cs", "design"]}, [], True, 96) == (True, 70)
    # A specific posting the student's skills match keeps the engine's score.
    assert guard("cs", {"disciplines": ["cs"]}, ["python"], True, 92) == (True, 92)
    assert coop_relevance._ordered_targets("cs", {"disciplines": ["business", "cs"]}) == ["cs", "business"]


def test_display_company_prefers_extracted_name_and_rejects_sentences_and_slugs():
    from app.coop import _display_company
    scraped = CoopCompany(slug="x", name="لطلاب وطالبات الجامعات الراغبين في اكتساب خبرة عملية وميدانية.")
    assert _display_company(scraped, {"company": "Riyadh Air"}) == "Riyadh Air"
    assert _display_company(scraped, {"company": "company-8837292bea88"}) == ""
    assert _display_company(CoopCompany(slug="y", name="COGNNA"), {"company": "company-95f5dec8958f"}) == "COGNNA"
    assert _display_company(CoopCompany(slug="z", name="التخصصات"), {}) == ""
    assert _display_company(CoopCompany(slug="h", name="help-ag"), {}) == "Help Ag"
    assert coop_relevance._hidden_reason("cs", {"disciplines": ["other"]}, []) == "Written for a different field than yours"
