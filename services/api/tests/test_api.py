import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"farq-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import SessionLocal, engine  # noqa: E402
from app.hermes import NIM_MODEL, resolve_hermes_selection  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AgentRun  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def test_hermes_provider_choice_is_allowlisted_and_per_run(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    assert resolve_hermes_selection("nim") == (NIM_MODEL, "nvidia")
    calls = []

    def finish_run(*args):
        calls.append(args)
        db = SessionLocal()
        run = db.get(AgentRun, args[0])
        if run is not None:
            run.status = "completed"
            db.commit()
        db.close()

    monkeypatch.setattr("app.main.run_agent", finish_run)
    thread_id = client.get("/api/demo").json()["thread_id"]

    selected = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "Use NIM", "provider": "nim"})
    assert selected.status_code == 202
    assert calls[-1][2] == "nim"

    default = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "Use the default"})
    assert default.status_code == 202
    assert calls[-1][2] is None

    invalid = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "Use anything", "provider": "custom"})
    assert invalid.status_code == 422


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


def test_settings_apply_rewrites_env_and_preserves_other_vars(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from app.settings_env import read_env_values

    env = tmp_path / ".env"
    env.write_text("# keep me\nOTHER=keep\nHERMES_API_KEY=" + "o" * 64 + "\n", encoding="utf-8")
    monkeypatch.setattr("app.main.ENV_PATH", env)

    key = "k" * 64
    response = client.post("/api/settings/hermes", json={"key": key, "provider": "gemini", "model": "gemini-2.5-flash"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "applied"
    assert payload["model"] == "gemini-2.5-flash"
    assert payload["provider"] == "gemini"

    values = read_env_values(env)
    assert values["HERMES_API_KEY"] == key
    assert values["HERMES_MODEL"] == "gemini-2.5-flash"
    assert values["HERMES_PROVIDER"] == "gemini"
    assert values["OTHER"] == "keep"
    assert "# keep me" in env.read_text(encoding="utf-8")


def test_settings_apply_rejects_short_key_and_unknown_model(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    env = tmp_path / ".env"
    original = "HERMES_API_KEY=" + "o" * 64 + "\n"
    env.write_text(original, encoding="utf-8")
    monkeypatch.setattr("app.main.ENV_PATH", env)

    assert client.post("/api/settings/hermes", json={"key": "too-short"}).status_code == 422
    unknown = client.post("/api/settings/hermes", json={"key": "k" * 64, "provider": "gemini", "model": "not-a-model"})
    assert unknown.status_code == 422
    assert env.read_text(encoding="utf-8") == original


def test_settings_apply_without_env_file_conflicts(client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr("app.main.ENV_PATH", tmp_path / ".env")
    response = client.post("/api/settings/hermes", json={"key": "k" * 64})
    assert response.status_code == 409


def test_gateway_401_error_mentions_apply():
    import httpx

    from app.hermes import raise_for_gateway_status

    response = httpx.Response(401, request=httpx.Request("POST", "http://127.0.0.1:8642/v1/runs"))
    with pytest.raises(RuntimeError, match="Apply"):
        raise_for_gateway_status(response)


def test_reset_restores_fresh_farq(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    internal = {"X-Farq-Internal-Token": "farq-internal-dev"}
    demo = client.get("/api/demo").json()
    roadmap = client.get("/api/students/demo-student/roadmap").json()

    client.put("/api/students/demo-student/roadmap/nodes/python-numpy", json={"status": "done"})
    fact = client.post("/internal/hermes/facts", headers=internal, json={
        "user_id": "demo-student",
        "category": "preference",
        "key": "reset_test_preference",
        "value": "temporary",
        "source_message_id": "temporary-message",
        "explicit": True,
    })
    assert fact.status_code == 200

    proposal = client.post("/internal/hermes/roadmap-proposals", headers=internal, json={
        "user_id": "demo-student",
        "base_version_id": roadmap["version_id"],
        "summary": "Temporary reset test proposal",
        "reasoning": "This proposal should disappear after the reset.",
        "operations": [{"type": "update_node", "node_id": "linear-algebra", "changes": {"tagline": "Temporary reset content"}}],
    })
    assert proposal.status_code == 200
    assert client.post(f"/api/roadmap-proposals/{proposal.json()['proposal_id']}/accept").status_code == 200

    def finish_run(*args):
        db = SessionLocal()
        run = db.get(AgentRun, args[0])
        if run is not None:
            run.status = "completed"
            db.commit()
        db.close()

    monkeypatch.setattr("app.main.run_agent", finish_run)
    sent = client.post(f"/api/chat/threads/{demo['thread_id']}/messages", json={"content": "Remember this"})
    assert sent.status_code == 202
    run_id = sent.json()["run_id"]

    assert client.post("/api/demo/reset", json={"confirm": "yes"}).status_code == 422
    reset = client.post("/api/demo/reset", json={"confirm": "RESET"})
    assert reset.status_code == 200

    fresh = client.get("/api/demo").json()
    assert fresh["student_id"] == "demo-student"
    assert fresh["thread_id"] != demo["thread_id"]
    assert client.get(f"/api/chat/threads/{fresh['thread_id']}/messages").json() == []
    assert client.get("/api/students/demo-student/context").json()["facts"] == []
    assert client.get("/api/students/demo-student/roadmap/proposals").json() == []
    assert client.get(f"/api/agent-runs/{run_id}").status_code == 404

    fresh_roadmap = client.get("/api/students/demo-student/roadmap").json()
    assert fresh_roadmap["version"] == 1
    assert all(node["status"] == "not-started" for node in fresh_roadmap["snapshot"]["nodes"])
    assert next(node for node in fresh_roadmap["snapshot"]["nodes"] if node["id"] == "linear-algebra")["tagline"] != "Temporary reset content"


def test_health_reports_hermes_model(client: TestClient):
    health = client.get("/api/health").json()
    assert health["status"] == "ok"
    assert isinstance(health["model"], str) and health["model"]
    assert health["provider"] in {"gemini", "nvidia"}


CANNED_QUIZ = '{"questions": [{"id": "q1", "type": "true_false", "question": "The sky is blue.", "answer": "True"}]}'


class _FakeQuizResponse:
    status_code = 200
    text = ""

    def __init__(self, payload: dict):
        self._payload = payload

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        return None


def _fake_quiz_client(status: dict, post_model: dict | None = None):
    calls: dict = {}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, headers=None, json=None):
            calls["auth"] = (headers or {}).get("Authorization")
            calls["session"] = (json or {}).get("session_id")
            if post_model is not None:
                post_model.update(json or {})
            return _FakeQuizResponse({"run_id": "run-quiz-1"})

        def get(self, url, headers=None):
            return _FakeQuizResponse(status)

    return FakeClient, calls


def test_quiz_generate_uses_gateway_and_writes_nothing(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from sqlalchemy import func, select

    from app.models import AgentRun as AgentRunModel

    FakeClient, calls = _fake_quiz_client({"status": "completed", "output": CANNED_QUIZ})
    monkeypatch.setattr("app.hermes.httpx.Client", FakeClient)
    db = SessionLocal()
    before = db.scalar(select(func.count()).select_from(AgentRunModel))
    db.close()

    response = client.post(
        "/api/quiz/generate",
        headers={"X-Hermes-Api-Key": "k" * 64},
        json={
            "source_text": "The sky is blue.",
            "count": 2,
            "difficulty": "Easy",
            "types": ["true_false"],
            "provider": "gemini",
            "model": "gemini-2.5-flash",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["output"] == CANNED_QUIZ
    assert body["model"] == "gemini-2.5-flash"
    assert body["provider"] == "gemini"
    assert calls["auth"] == "Bearer " + "k" * 64
    assert calls["session"].startswith("quiz-")

    db = SessionLocal()
    after = db.scalar(select(func.count()).select_from(AgentRunModel))
    db.close()
    assert after == before


def test_quiz_generate_rejects_bad_input(client: TestClient):
    headers = {"X-Hermes-Api-Key": "k" * 64}
    base = {"source_text": "Some slides.", "count": 2, "difficulty": "Easy", "types": ["mcq"]}
    assert client.post("/api/quiz/generate", headers=headers, json={**base, "source_text": ""}).status_code == 422
    assert client.post("/api/quiz/generate", headers=headers, json={**base, "count": 0}).status_code == 422
    assert client.post("/api/quiz/generate", headers=headers, json={**base, "types": []}).status_code == 422
    unknown = client.post(
        "/api/quiz/generate", headers=headers,
        json={**base, "provider": "gemini", "model": "not-a-model"},
    )
    assert unknown.status_code == 422


def test_quiz_generate_maps_gateway_failure(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    FakeClient, _ = _fake_quiz_client({"status": "failed", "error": "model exploded"})
    monkeypatch.setattr("app.hermes.httpx.Client", FakeClient)
    response = client.post(
        "/api/quiz/generate",
        headers={"X-Hermes-Api-Key": "k" * 64},
        json={"source_text": "Slides.", "count": 1, "difficulty": "Easy", "types": ["mcq"]},
    )
    assert response.status_code == 502
    assert "model exploded" in response.json()["detail"]


def test_nvapi_key_selects_nim_ladder_only():
    from app import hermes as hermes_module

    hermes_module._cooldown.clear()
    assert hermes_module.is_nvapi_key("nvapi-abc123")
    assert hermes_module.is_nvapi_key("  NVAPI-xyz ")
    assert not hermes_module.is_nvapi_key("sk-ant-123")
    assert not hermes_module.is_nvapi_key(None)
    assert hermes_module.resolve_hermes_selection("nim") == (hermes_module.NIM_CHAIN[0], "nvidia")
    assert hermes_module.resolve_hermes_selection("nim", "nvidia/nemotron-3-super-120b-a12b") == ("nvidia/nemotron-3-super-120b-a12b", "nvidia")
    # Even an explicit Gemini selection degrades within NIM only on an nvapi key.
    chain = hermes_module.candidate_chain("gemini", "gemini-3.8-flash", "nvapi-test-key")
    assert [model for model, _ in chain] == hermes_module.NIM_CHAIN
    assert {provider for _, provider in chain} == {"nvidia"}


def test_nvapi_key_never_becomes_gateway_bearer(monkeypatch: pytest.MonkeyPatch):
    from app import hermes as hermes_module

    monkeypatch.setattr(hermes_module, "HERMES_API_KEY", "server-gateway-key-0123456789abcdef")
    assert hermes_module.effective_hermes_key("nvapi-abc123") == "server-gateway-key-0123456789abcdef"
    assert hermes_module.effective_hermes_key("plain-tab-key-0123456789abcdef") == "plain-tab-key-0123456789abcdef"


def test_internal_endpoints_resolve_display_name(client: TestClient):
    internal = {"X-Farq-Internal-Token": "farq-internal-dev"}
    # The agent sometimes passes the display name instead of the UUID.
    profile = client.get("/internal/hermes/students/Demo Student/profile", headers=internal)
    assert profile.status_code == 200
    assert client.get("/internal/hermes/students/demo-student/context", headers=internal).status_code == 200
    fact = client.post("/internal/hermes/facts", headers=internal, json={
        "user_id": "demo student",
        "category": "preference",
        "key": "display_name_fallback",
        "value": "works",
        "source_message_id": "test-message",
        "explicit": True,
    })
    assert fact.status_code == 200
    assert client.get("/internal/hermes/students/No Such Person/profile", headers=internal).status_code == 404
    # Ambiguous names still 404 rather than guessing.
    client.post("/api/students", json={"display_name": "Sam Same"})
    client.post("/api/students", json={"display_name": "sam same"})
    assert client.get("/internal/hermes/students/Sam Same/profile", headers=internal).status_code == 404


def test_rewind_drops_message_and_later(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app.database import SessionLocal
    from app.models import AgentRun, ChatMessage

    monkeypatch.setattr("app.main.run_agent", lambda *args: None)
    thread_id = client.get("/api/demo").json()["thread_id"]

    first = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "First prompt"}).json()["message_id"]
    second = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "Second prompt"}).json()["message_id"]
    db = SessionLocal()
    for run in db.query(AgentRun).filter(AgentRun.thread_id == thread_id, AgentRun.status == "queued").all():
        run.status = "completed"
    db.commit()
    db.close()

    rewound = client.post(f"/api/chat/threads/{thread_id}/rewind", json={"message_id": first})
    assert rewound.status_code == 200
    assert rewound.json()["deleted"] >= 2
    remaining = {message["id"] for message in client.get(f"/api/chat/threads/{thread_id}/messages").json()}
    assert first not in remaining
    assert second not in remaining

    assert client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "x"}).status_code == 202
    db = SessionLocal()
    for run in db.query(AgentRun).filter(AgentRun.thread_id == thread_id, AgentRun.status == "queued").all():
        run.status = "completed"
    db.commit()
    db.close()
    assert client.post(f"/api/chat/threads/{thread_id}/rewind", json={"message_id": "nope"}).status_code == 404

    # A live run blocks the rewind so it cannot append onto truncated history.
    ours = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "Blocked prompt"}).json()["message_id"]
    db = SessionLocal()
    for run in db.query(AgentRun).filter(AgentRun.thread_id == thread_id, AgentRun.status == "queued").all():
        run.status = "completed"
    live = AgentRun(thread_id=thread_id, user_message_id=ours, status="running")
    db.add(live)
    db.commit()
    assert client.post(f"/api/chat/threads/{thread_id}/rewind", json={"message_id": ours}).status_code == 409
    live.status = "failed"
    db.commit()
    db.close()
    assert client.post(f"/api/chat/threads/{thread_id}/rewind", json={"message_id": ours}).status_code == 200
    db = SessionLocal()
    assert db.get(ChatMessage, ours) is None
    db.close()
