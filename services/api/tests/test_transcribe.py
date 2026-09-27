import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-transcribe-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app import transcribe as transcribe_module  # noqa: E402
from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.transcribe import MAX_AUDIO_BYTES, TranscribeError, extract_transcript, normalize_mime_type, transcribe_audio  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


class FakeResponse:
    def __init__(self, payload=None, status_code=200, headers=None):
        self._payload = payload or {}
        self.status_code = status_code
        self.headers = headers or {}
        self.text = "fake-error-body"

    def json(self):
        return self._payload


def fake_upload_client(posts, states=("ACTIVE",), transcript="Hello world"):
    """Mock the Files API upload -> ACTIVE poll -> generate -> delete flow."""
    state = {"polls": 0}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, *args, **kwargs):
            posts.append((url, kwargs.get("json", {})))
            if url == transcribe_module.UPLOAD_URL:
                return FakeResponse({}, headers={"x-goog-upload-url": "https://upload.test/session"})
            # Real transcribe responses carry audioTranscription, not text parts.
            return FakeResponse({"candidates": [{"content": {"parts": [{"audioTranscription": {"text": transcript}}]}}]})

        def put(self, *args, **kwargs):
            return FakeResponse({"file": {"uri": "https://test/files/abc", "name": "files/abc"}})

        def get(self, *args, **kwargs):
            state["polls"] += 1
            current = states[min(state["polls"] - 1, len(states) - 1)]
            return FakeResponse({"state": current})

        def delete(self, url, *args, **kwargs):
            posts.append((f"DELETE {url}", {}))
            return FakeResponse({})

    return FakeClient


def success_client(posts, **kwargs):
    monkey = kwargs.pop("monkey", None)
    client_cls = fake_upload_client(posts, **kwargs)
    if monkey is not None:
        monkey.setenv("GEMINI_API_KEY", "test-key-1234567890")
        monkey.setattr(transcribe_module.httpx, "Client", client_cls)
    return client_cls


def test_normalize_accepts_browser_mime_types() -> None:
    assert normalize_mime_type("audio/webm;codecs=opus", "voice.webm") == "audio/webm"
    assert normalize_mime_type("audio/mp4", "voice.m4a") == "audio/mp4"


def test_normalize_falls_back_to_filename() -> None:
    assert normalize_mime_type("application/octet-stream", "voice.webm") == "audio/webm"


def test_normalize_rejects_unknown_types() -> None:
    with pytest.raises(TranscribeError) as exc:
        normalize_mime_type("text/plain", "notes.txt")
    assert exc.value.status == 422


def test_empty_audio_is_rejected() -> None:
    with pytest.raises(TranscribeError) as exc:
        transcribe_audio(b"", "audio/webm", "voice.webm")
    assert exc.value.status == 422


def test_oversize_audio_is_rejected() -> None:
    with pytest.raises(TranscribeError) as exc:
        transcribe_audio(b"x" * (MAX_AUDIO_BYTES + 1), "audio/webm", "voice.webm")
    assert exc.value.status == 413


def test_missing_gemini_key_is_401(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    with pytest.raises(TranscribeError) as exc:
        transcribe_audio(b"fake-audio", "audio/webm", "voice.webm")
    assert exc.value.status == 401


def test_success_uploads_then_generates_by_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    posts: list = []
    success_client(posts, monkey=monkeypatch)
    assert transcribe_audio(b"fake-audio", "audio/webm", "voice.webm") == "Hello world"
    urls = [url for url, _ in posts]
    assert transcribe_module.UPLOAD_URL in urls
    generate = [body for url, body in posts if "generateContent" in url][0]
    part = generate["contents"][0]["parts"][0]
    # File reference, not inline bytes — inline only works for seconds-long clips.
    assert part["fileData"]["fileUri"] == "https://test/files/abc"
    assert generate["generationConfig"]["audioTranscriptionConfig"] == {"mode": "SMART"}
    assert any(url.startswith("DELETE") for url, _ in posts)


def test_processing_file_is_polled_until_active(monkeypatch: pytest.MonkeyPatch) -> None:
    posts: list = []
    success_client(posts, states=("PROCESSING", "PROCESSING", "ACTIVE"), monkey=monkeypatch)
    assert transcribe_audio(b"fake-audio", "audio/webm", "voice.webm") == "Hello world"


def test_failed_file_state_is_502(monkeypatch: pytest.MonkeyPatch) -> None:
    posts: list = []
    success_client(posts, states=("FAILED",), monkey=monkeypatch)
    with pytest.raises(TranscribeError) as exc:
        transcribe_audio(b"fake-audio", "audio/webm", "voice.webm")
    assert exc.value.status == 502


def test_empty_transcript_reports_block_reason(monkeypatch: pytest.MonkeyPatch) -> None:
    posts: list = []
    success_client(posts, transcript="", monkey=monkeypatch)

    def empty_generate(*args, **kwargs):
        return {"candidates": [], "promptFeedback": {"blockReason": "SAFETY"}}

    monkeypatch.setattr(transcribe_module, "_generate", empty_generate)
    with pytest.raises(TranscribeError) as exc:
        transcribe_audio(b"fake-audio", "audio/webm", "voice.webm")
    assert exc.value.status == 502
    assert "blocked" in str(exc.value)


def test_upstream_generate_error_is_502(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-1234567890")

    class FailingClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def post(self, url, *args, **kwargs):
            if url == transcribe_module.UPLOAD_URL:
                return FakeResponse({}, headers={"x-goog-upload-url": "https://upload.test/session"})
            return FakeResponse({}, status_code=500)

        def put(self, *args, **kwargs):
            return FakeResponse({"file": {"uri": "https://test/files/abc", "name": "files/abc"}})

        def get(self, *args, **kwargs):
            return FakeResponse({"state": "ACTIVE"})

        def delete(self, *args, **kwargs):
            return FakeResponse({})

    monkeypatch.setattr(transcribe_module.httpx, "Client", FailingClient)
    with pytest.raises(TranscribeError) as exc:
        transcribe_audio(b"fake-audio", "audio/webm", "voice.webm")
    assert exc.value.status == 502


def test_extract_transcript_joins_parts() -> None:
    payload = {"candidates": [{"content": {"parts": [{"text": "  Hi "}, {"other": 1}, {"text": "there"}]}}]}
    assert extract_transcript(payload) == "Hi there"
    audio = {"candidates": [{"content": {"parts": [{"audioTranscription": {"text": "Hello world"}}]}}]}
    assert extract_transcript(audio) == "Hello world"
    words = {"candidates": [{"content": {"parts": [{"audioTranscription": {"words": [{"word": "Hi"}, {"word": "there"}]}}]}}]}
    assert extract_transcript(words) == "Hi there"
    assert extract_transcript({}) == ""


def test_endpoint_returns_text(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.main.transcribe_audio", lambda *args: "Hi Hermes")
    response = client.post("/api/transcribe", files={"audio": ("voice.webm", b"fake-audio", "audio/webm")})
    assert response.status_code == 200
    assert response.json() == {"text": "Hi Hermes"}


def test_endpoint_maps_transcribe_errors(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args):
        raise TranscribeError("Voice clip is too long; keep recordings under 3 minutes", status=413)

    monkeypatch.setattr("app.main.transcribe_audio", boom)
    response = client.post("/api/transcribe", files={"audio": ("voice.webm", b"fake-audio", "audio/webm")})
    assert response.status_code == 413


def test_endpoint_rejects_oversize_without_mock(client: TestClient) -> None:
    big = b"x" * (MAX_AUDIO_BYTES + 1)
    response = client.post("/api/transcribe", files={"audio": ("voice.webm", big, "audio/webm")})
    assert response.status_code == 413
