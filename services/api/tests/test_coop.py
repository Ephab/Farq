import os
import tempfile
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"farq-coop-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.coop import sync_official_coop_sources  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CoopCompany, CoopPosting, StudentFact  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def test_demo_student_gets_ranked_company_and_posting_matches(client: TestClient):
    response = client.get("/api/students/demo-student/coop/overview")
    assert response.status_code == 200
    body = response.json()
    assert len(body["companies"]) == 8
    assert body["postings"]
    assert all(item["fit_tier"] in {"Strong match", "Good match", "Explore"} for item in body["companies"])
    assert all(item["is_demo"] for item in body["postings"])
    assert body["verified_openings"] == 0


def test_explicit_research_and_ai_signals_raise_research_company(client: TestClient):
    student = client.post("/api/students", json={"display_name": "Research Student"}).json()
    db = SessionLocal()
    db.add(StudentFact(student_id=student["student_id"], category="goal", key="direction", value_json='"research"', source_kind="onboarding"))
    db.add(StudentFact(student_id=student["student_id"], category="skill", key="machine learning", value_json='"python and machine learning"', source_kind="onboarding"))
    db.commit(); db.close()
    matches = client.get(f"/api/students/{student['student_id']}/coop/companies").json()["results"]
    assert matches[0]["orientation"] == "research"
    assert any("research" in reason.lower() for reason in matches[0]["reasons"])


def test_save_dismiss_and_student_isolation(client: TestClient):
    saved = client.post("/api/students/demo-student/coop/companies/tahakom/status", json={"status": "saved"})
    assert saved.status_code == 200
    assert any(item["id"] == "tahakom" for item in client.get("/api/students/demo-student/coop/companies?status=saved").json()["results"])

    other = client.post("/api/students", json={"display_name": "Other Student"}).json()
    assert client.get(f"/api/students/{other['student_id']}/coop/companies?status=saved").json()["results"] == []

    client.post("/api/students/demo-student/coop/companies/tahakom/status", json={"status": "dismissed"})
    assert all(item["id"] != "tahakom" for item in client.get("/api/students/demo-student/coop/companies").json()["results"])
    client.post("/api/students/demo-student/coop/companies/tahakom/status", json={"status": "neutral"})


def test_internal_hermes_tools_require_token_and_return_provenance(client: TestClient):
    path = "/internal/hermes/students/demo-student/coop/companies?query=govtech&limit=3"
    assert client.get(path).status_code == 401
    response = client.get(path, headers={"X-Farq-Internal-Token": "farq-internal-dev"})
    assert response.status_code == 200
    assert response.json()["results"][0]["id"] in {"tahakom", "elm", "sdaia-jrcai"}
    target = client.get(
        "/internal/hermes/students/demo-student/coop/company/tahakom",
        headers={"X-Farq-Internal-Token": "farq-internal-dev"},
    )
    assert target.status_code == 200
    assert target.json()["source_url"].startswith("https://")


def test_official_sync_marks_explicit_closure_and_keeps_other_catalog_entries(client: TestClient):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "careers.tahakom.com":
            text = "There are no current openings in this category"
        elif request.url.host == "www.kacst.gov.sa":
            text = "Cooperative training — Apply Now"
        else:
            text = "Cooperative training program information"
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=text)

    db = SessionLocal()
    result = sync_official_coop_sources(db, httpx.Client(transport=httpx.MockTransport(handler)))
    assert result["status"] == "completed"
    assert db.get(CoopCompany, "tahakom").source_status == "closed"
    assert db.get(CoopCompany, "kaust").source_status == "program_page"
    official = db.query(CoopPosting).filter_by(source="official:kacst").one()
    assert official.status == "verified_open"
    assert official.is_demo is False
    db.close()
