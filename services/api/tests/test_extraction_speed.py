"""Evidence extraction: direct fast-model path, chunking, caching, fallback and background jobs."""

import json
import os
import tempfile
import time
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-extraction-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app import hermes, llm_direct  # noqa: E402
from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.sources import SourceError, extract, jobs  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


@pytest.fixture(autouse=True)
def clean():
    extract.clear_cache()
    hermes._cooldown.clear()
    jobs.reset()
    yield
    extract.clear_cache()
    hermes._cooldown.clear()


def course_rows(n: int, start: int = 0) -> str:
    return json.dumps({"items": [{"kind": "course", "title": f"Course {start + i}", "data": {"code": f"C {start + i}"}} for i in range(n)]})


def test_split_chunks_keeps_short_text_whole_and_cuts_long_text_on_lines():
    assert extract.split_chunks("short") == ["short"]
    text = "\n".join(f"COE {i} Some Course Name 3 A" for i in range(1000))
    chunks = extract.split_chunks(text)
    assert len(chunks) > 3 and all(len(c) <= extract.CHUNK_CHARS for c in chunks)
    assert "\n".join(chunks) == text  # nothing lost, nothing duplicated
    assert all(len(c) <= extract.CHUNK_CHARS for c in extract.split_chunks("x" * 20_000))


def test_direct_path_skips_the_gateway_and_caches_by_content(monkeypatch):
    calls: list[str] = []

    def direct(instructions, prompt, **kwargs):
        calls.append(prompt)
        return llm_direct.DirectResult(course_rows(2), "gemini-3.5-flash-lite", "gemini")

    monkeypatch.setattr(extract, "run_direct_json", direct)
    monkeypatch.setattr(extract, "run_json_prompt", lambda *a, **k: pytest.fail("gateway must not be used"))
    items = extract.extract_items("transcript_pdf", "COE 202 Digital Logic A " * 5, "t.pdf")
    assert [i.title for i in items] == ["Course 0", "Course 1"]
    again = extract.extract_items("transcript_pdf", "COE 202   Digital Logic A " * 5, "other.pdf")  # whitespace-only difference
    assert len(calls) == 1 and again[0].source_ref == "other.pdf"
    extract.extract_items("cv_pdf", "COE 202 Digital Logic A " * 5, "cv.pdf")  # another kind is another key
    assert len(calls) == 2


def test_long_documents_are_extracted_in_parallel_chunks_and_merged(monkeypatch):
    seen: list[str] = []
    progress: list[tuple] = []

    def direct(instructions, prompt, **kwargs):
        seen.append(prompt)
        return llm_direct.DirectResult(course_rows(1, len(seen) * 10), "m", "gemini")

    monkeypatch.setattr(extract, "run_direct_json", direct)
    text = "\n".join(f"COE {i} Some Course Name 3 A" for i in range(800))
    items = extract.extract_items("transcript_pdf", text, "t.pdf", progress=lambda stage, **d: progress.append((stage, d)))
    assert len(seen) == len(extract.split_chunks(text)) > 1
    assert len(items) == len(seen)
    assert progress[-1] == ("extracting", {"done": len(seen), "total": len(seen)})


def test_partial_chunk_failure_keeps_good_rows_and_warns(monkeypatch):
    notes: list[tuple] = []
    state = {"n": 0}

    def direct(instructions, prompt, **kwargs):
        state["n"] += 1
        if "COE 0 " in prompt:
            raise llm_direct.DirectUnavailable("all busy", configured=True)
        return llm_direct.DirectResult(course_rows(1), "m", "gemini")

    def gateway(*args, **kwargs):
        raise hermes.HermesJsonError("All 3 models tried failed 503", status=502)

    monkeypatch.setattr(extract, "run_direct_json", direct)
    monkeypatch.setattr(extract, "run_json_prompt", gateway)
    text = "\n".join(f"COE {i} Some Course Name 3 A" for i in range(800))
    items = extract.extract_items("transcript_pdf", text, "t.pdf", progress=lambda stage, **d: notes.append((stage, d)))
    assert items
    assert any(stage == "warning" for stage, _ in notes)
    extract.clear_cache()
    assert extract._cache_get(extract._cache_key("transcript_pdf", extract.tidy_text(text))) is None  # partial results are not cached


def test_gateway_is_the_fallback_when_direct_is_unavailable(monkeypatch):
    def direct(*args, **kwargs):
        raise llm_direct.DirectUnavailable("no key", configured=False)

    seen = {}

    def gateway(kind, prompt, instructions, provider, model, key, timeout_seconds):
        seen["kind"] = kind
        return course_rows(1)

    monkeypatch.setattr(extract, "run_direct_json", direct)
    monkeypatch.setattr(extract, "run_json_prompt", gateway)
    assert len(extract.extract_items("cv_pdf", "Education BSc " * 10, "cv.pdf")) == 1
    assert seen["kind"] == "ingest"


def test_total_failure_is_a_friendly_source_error(monkeypatch):
    monkeypatch.setattr(extract, "run_direct_json", lambda *a, **k: (_ for _ in ()).throw(llm_direct.DirectUnavailable("503", configured=True)))
    monkeypatch.setattr(extract, "run_json_prompt", lambda *a, **k: (_ for _ in ()).throw(hermes.HermesJsonError("All 16 models tried failed. Last errors: x: 503 overloaded", status=502)))
    with pytest.raises(SourceError) as error:
        extract.extract_items("cv_pdf", "Education BSc " * 10, "cv.pdf")
    assert "busy" in str(error.value) and "All 16 models" not in str(error.value)


def _mock_client(handler, monkeypatch):
    real = httpx.Client

    def factory(*args, **kwargs):
        return real(transport=httpx.MockTransport(handler), timeout=kwargs.get("timeout"))

    monkeypatch.setattr(llm_direct.httpx, "Client", factory)


def test_direct_call_hops_to_the_next_model_immediately_on_overload(monkeypatch):
    monkeypatch.setenv("WAYPOINT_DIRECT_EXTRACT", "on")
    monkeypatch.setenv("GEMINI_API_KEY", "g" * 24)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    tried: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        model = request.url.path.split("/models/")[1].split(":")[0]
        tried.append(model)
        if model == llm_direct.GEMINI_EXTRACT_CHAIN[0]:
            return httpx.Response(503, json={"error": {"status": "UNAVAILABLE", "message": "high demand"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": '{"items": []}'}]}}]})

    _mock_client(handler, monkeypatch)
    started = time.monotonic()
    result = llm_direct.run_direct_json("sys", "prompt")
    assert result.model == llm_direct.GEMINI_EXTRACT_CHAIN[1] and tried == llm_direct.GEMINI_EXTRACT_CHAIN[:2]
    assert time.monotonic() - started < 2
    # The overloaded model now rests, so the next call skips it without a wasted round trip.
    tried.clear()
    llm_direct.run_direct_json("sys", "prompt")
    assert tried == [llm_direct.GEMINI_EXTRACT_CHAIN[1]]


def test_direct_call_with_rejected_key_stops_trying_that_provider(monkeypatch):
    monkeypatch.setenv("WAYPOINT_DIRECT_EXTRACT", "on")
    monkeypatch.setenv("GEMINI_API_KEY", "g" * 24)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    tried: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        tried.append(request.url.path)
        return httpx.Response(403, json={"error": {"message": "API key not valid"}})

    _mock_client(handler, monkeypatch)
    with pytest.raises(llm_direct.DirectUnavailable) as error:
        llm_direct.run_direct_json("sys", "prompt")
    assert len(tried) == 1 and error.value.configured


def test_direct_is_unconfigured_without_keys_or_when_switched_off(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.setenv("WAYPOINT_DIRECT_EXTRACT", "on")
    with pytest.raises(llm_direct.DirectUnavailable) as error:
        llm_direct.run_direct_json("s", "p")
    assert not error.value.configured
    monkeypatch.setenv("GEMINI_API_KEY", "g" * 24)
    monkeypatch.setenv("WAYPOINT_DIRECT_EXTRACT", "off")
    assert not llm_direct.is_configured()


def new_student(client: TestClient) -> str:
    return client.post("/api/students", json={"display_name": "Test", "institution": "KFUPM", "program": "Computer Science", "year_label": "Year 2", "grad_target": "2028"}).json()["student_id"]


def wait_for(client: TestClient, sid: str, source_id: str, done=("ready", "failed"), timeout=5.0) -> dict:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        row = next(item for item in client.get(f"/api/students/{sid}/sources").json() if item["id"] == source_id)
        if row["status"] in done:
            return row
        time.sleep(0.05)
    raise AssertionError("source never finished")


def test_background_upload_returns_at_once_then_reports_progress_and_result(client, monkeypatch):
    sid = new_student(client)
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "transcript_pdf"}).json()
    monkeypatch.setattr("app.pipeline.evidence_step.extract_pdf_text", lambda data: "COE 202 Digital Logic Design 3 A " * 6)
    release = {"go": False}

    def slow_direct(instructions, prompt, **kwargs):
        while not release["go"]:
            time.sleep(0.01)
        return llm_direct.DirectResult(course_rows(2), "m", "gemini")

    monkeypatch.setattr(extract, "run_direct_json", slow_direct)
    response = client.post(f"/api/students/{sid}/sources/{source['id']}/upload?background=true", files={"file": ("t.pdf", b"%PDF-1.4", "application/pdf")})
    assert response.status_code == 200 and response.json()["status"] == "syncing"
    during = next(item for item in client.get(f"/api/students/{sid}/sources").json() if item["id"] == source["id"])
    assert during["status"] == "syncing" and during["stage"] in {"queued", "reading", "extracting"}
    assert client.post(f"/api/students/{sid}/sources/{source['id']}/upload?background=true", files={"file": ("t.pdf", b"%PDF-1.4", "application/pdf")}).status_code == 409
    release["go"] = True
    finished = wait_for(client, sid, source["id"])
    assert finished["status"] == "ready" and "stage" not in finished
    evidence = client.get(f"/api/students/{sid}/evidence").json()
    assert len(evidence) == 2 and {item["status"] for item in evidence} == {"suggested"}


def test_background_failures_are_recorded_with_a_reason(client, monkeypatch):
    sid = new_student(client)
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "cv_pdf"}).json()
    bad = client.post(f"/api/students/{sid}/sources/{source['id']}/upload?background=true", files={"file": ("cv.txt", b"hello", "text/plain")})
    assert bad.status_code == 422
    row = wait_for(client, sid, source["id"])
    assert row["status"] == "failed" and "not a PDF" in row["error"]
    monkeypatch.setattr("app.pipeline.evidence_step.extract_pdf_text", lambda data: "Education BSc " * 20)
    monkeypatch.setattr(extract, "run_direct_json", lambda *a, **k: (_ for _ in ()).throw(llm_direct.DirectUnavailable("503", configured=True)))
    monkeypatch.setattr(extract, "run_json_prompt", lambda *a, **k: (_ for _ in ()).throw(hermes.HermesJsonError("All 16 models tried failed 503", status=502)))
    client.post(f"/api/students/{sid}/sources/{source['id']}/upload?background=true", files={"file": ("cv.pdf", b"%PDF-1.4", "application/pdf")})
    row = wait_for(client, sid, source["id"])
    assert row["status"] == "failed" and "busy" in row["error"]


def test_interrupted_source_is_reported_failed_not_syncing_forever(client):
    from app.database import SessionLocal
    from app.models import DataSource

    sid = new_student(client)
    source = client.post(f"/api/students/{sid}/sources", json={"kind": "github", "value": "octocat"}).json()
    db = SessionLocal()
    db.get(DataSource, source["id"]).status = "syncing"
    db.commit()
    db.close()
    row = client.get(f"/api/students/{sid}/sources").json()[0]
    assert row["status"] == "failed" and "interrupted" in row["error"]
