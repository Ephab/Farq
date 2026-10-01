import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-suggest-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app import suggestions  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ChatMessage  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def add_messages(thread_id: str, user_text: str, reply: str, metadata_json: str | None = None) -> str:
    db = SessionLocal()
    db.add(ChatMessage(thread_id=thread_id, role="user", content=user_text))
    db.flush()
    message = ChatMessage(thread_id=thread_id, role="assistant", content=reply, metadata_json=metadata_json)
    db.add(message)
    db.commit()
    message_id = message.id
    db.close()
    return message_id


def test_clean_suggestions_filters_untrusted_output():
    raw = ["  Explain more ", "explain more", "see https://evil.test", "x" * 80, 5, "Next step?", "Another one", "Fourth"]
    assert suggestions.clean_suggestions(raw) == ["Explain more", "Next step?", "Another one"]
    assert suggestions.clean_suggestions("nope") == []


def test_prompt_inputs_are_truncated(monkeypatch: pytest.MonkeyPatch):
    seen = {}

    class Resp:
        status_code = 200
        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": '{"s":["One","Two","Three"]}'}]}}]}

    def fake_post(url, headers, json, timeout):
        seen["text"] = json["contents"][0]["parts"][0]["text"]
        seen["max"] = json["generationConfig"]["maxOutputTokens"]
        seen["tools"] = "tools" in json
        return Resp()

    monkeypatch.setenv("GEMINI_API_KEY", "k" * 24)
    monkeypatch.setattr(suggestions.httpx, "post", fake_post)
    assert suggestions.generate_suggestions("a" * 5000, "b" * 5000) == ["One", "Two", "Three"]
    assert seen["text"].count("a") < 700 and seen["text"].count("b") < 700
    assert seen["max"] == 120 and not seen["tools"]


def test_no_key_returns_empty(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    thread_id = client.get("/api/demo").json()["thread_id"]
    message_id = add_messages(thread_id, "Help me plan", "Start with the first node.")
    body = client.get(f"/api/chat/threads/{thread_id}/suggestions", params={"message_id": message_id}).json()
    assert body == {"suggestions": [], "source": "none"}


def test_suggestions_are_cached_and_only_for_thread_end(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    calls = []
    monkeypatch.setattr(suggestions, "generate_suggestions", lambda u, r: calls.append((u, r)) or ["A", "B", "C"])
    thread_id = client.get("/api/demo").json()["thread_id"]
    message_id = add_messages(thread_id, "What next?", "Try the quiz.")
    url = f"/api/chat/threads/{thread_id}/suggestions"
    first = client.get(url, params={"message_id": message_id}).json()
    second = client.get(url, params={"message_id": message_id}).json()
    assert first == second == {"suggestions": ["A", "B", "C"], "source": "model"}
    assert len(calls) == 1 and calls[0] == ("What next?", "Try the quiz.")
    # Once the thread moves on, the old message gets nothing.
    add_messages(thread_id, "Later", "Later reply")
    assert client.get(url, params={"message_id": message_id}).json()["suggestions"] == []


def test_reply_with_its_own_controls_skips_the_model(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(suggestions, "generate_suggestions", lambda u, r: pytest.fail("must not call the model"))
    thread_id = client.get("/api/demo").json()["thread_id"]
    message_id = add_messages(thread_id, "Hi", "Pick one", '{"follow_ups":[{"id":"a","label":"A","prompt":"A"}]}')
    assert client.get(f"/api/chat/threads/{thread_id}/suggestions", params={"message_id": message_id}).json()["suggestions"] == []
