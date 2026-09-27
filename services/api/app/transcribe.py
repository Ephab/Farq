from __future__ import annotations

"""Server-side voice dictation via Gemini 3.5 Transcribe.

The browser records audio with MediaRecorder and POSTs the finished clip to
``POST /api/transcribe``; this module uploads the bytes through the Gemini
Files API, transcribes by file reference with the server's ``GEMINI_API_KEY``
(the same provider key the Hermes gateway uses for generation), then deletes
the uploaded file. The browser never sees the key and never calls Google
directly. Inline audio only works for clips of a few seconds, so the Files
API upload is required for real recordings (see the Gemini audio
transcription guide).

Audio is held in memory only and never written to disk, SQLite, or Hermes
memory, and the Files API copy is deleted right after transcription. The
returned transcript is a composer draft: it becomes a chat message (and
possibly a StudentFact) only after the student presses Send through the
normal chat path.
"""

import logging
import os
import time

import httpx

logger = logging.getLogger("waypoint.transcribe")

TRANSCRIBE_MODEL = "gemini-3.5-transcribe"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files"
UPLOAD_TIMEOUT_SECONDS = 60
GENERATE_TIMEOUT_SECONDS = 120
# Uploaded audio is usually ACTIVE immediately; bound the wait for slow files.
ACTIVE_WAIT_SECONDS = 60
ACTIVE_POLL_SECONDS = 2

# ~2-3 minutes of recorded speech audio. Clips are held in memory only.
MAX_AUDIO_BYTES = 10 * 1024 * 1024

# Intersection of MediaRecorder outputs and the Files API's supported list.
ALLOWED_MIME_TYPES = frozenset({
    "audio/webm",
    "audio/ogg",
    "audio/opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
    "audio/m4a",
    "audio/x-m4a",
    "audio/flac",
})

EXTENSION_MIME = {
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
}


class TranscribeError(RuntimeError):
    """Voice transcription failure with the HTTP status the API should return."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def normalize_mime_type(content_type: str | None, filename: str | None) -> str:
    """Resolve the uploaded clip to a Gemini audio MIME type.

    Falls back to the filename extension because some browsers post
    MediaRecorder blobs as ``application/octet-stream``.
    """
    base = (content_type or "").split(";")[0].strip().lower()
    if base in ALLOWED_MIME_TYPES:
        return base
    name = (filename or "").lower()
    suffix = f".{name.rsplit('.', 1)[-1]}" if "." in name else ""
    if suffix in EXTENSION_MIME:
        return EXTENSION_MIME[suffix]
    raise TranscribeError(
        "Unsupported audio type; record as WebM, MP3, MP4, Ogg, or WAV",
        status=422,
    )


def extract_transcript(payload: dict) -> str:
    """Join a generateContent response into one transcript.

    The transcribe model returns the text in ``part.audioTranscription.text``
    (plain ``part.text`` is the fallback); word annotations are joined when
    neither is present.
    """
    parts: list[str] = []
    candidates = payload.get("candidates") or []
    for candidate in candidates:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
                continue
            transcription = part.get("audioTranscription") or {}
            text = transcription.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
                continue
            words = [word.get("word") for word in transcription.get("words") or []]
            words = [word for word in words if isinstance(word, str) and word.strip()]
            if words:
                parts.append(" ".join(words))
    return " ".join(parts).strip()


def _upload_audio(client: httpx.Client, key: str, data: bytes, mime_type: str) -> tuple[str, str]:
    """Upload through the Files API; returns (file_uri, file_name)."""
    headers = {"x-goog-api-key": key}
    try:
        start = client.post(
            UPLOAD_URL,
            headers={
                **headers,
                "Content-Type": "application/json",
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(len(data)),
                "X-Goog-Upload-Header-Content-Type": mime_type,
            },
            json={"file": {"display_name": "waypoint-voice-clip"}},
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise TranscribeError(f"Audio upload failed: {exc}", status=502) from exc
    if start.status_code >= 400:
        raise TranscribeError("Audio upload was rejected; try again or type your message", status=502)
    upload_url = start.headers.get("x-goog-upload-url")
    if not upload_url:
        raise TranscribeError("Audio upload failed; try again or type your message", status=502)
    try:
        finish = client.put(
            upload_url,
            headers={
                "Content-Length": str(len(data)),
                "X-Goog-Upload-Offset": "0",
                "X-Goog-Upload-Command": "upload, finalize",
                "Content-Type": mime_type,
            },
            content=data,
            timeout=UPLOAD_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise TranscribeError(f"Audio upload failed: {exc}", status=502) from exc
    if finish.status_code >= 400:
        raise TranscribeError("Audio upload was rejected; try again or type your message", status=502)
    try:
        resource = finish.json().get("file") or {}
    except ValueError as exc:
        raise TranscribeError("Audio upload failed; try again or type your message", status=502) from exc
    uri, name = resource.get("uri"), resource.get("name")
    if not uri or not name:
        raise TranscribeError("Audio upload failed; try again or type your message", status=502)
    return uri, name


def _await_active(client: httpx.Client, key: str, name: str) -> None:
    """Wait until the uploaded file leaves PROCESSING (usually immediate)."""
    deadline = time.monotonic() + ACTIVE_WAIT_SECONDS
    while True:
        try:
            response = client.get(
                f"{API_BASE}/{name}",
                headers={"x-goog-api-key": key},
                timeout=UPLOAD_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise TranscribeError(f"Transcription failed: {exc}", status=502) from exc
        if response.status_code >= 400:
            raise TranscribeError("Transcription failed; try again or type your message", status=502)
        try:
            state = response.json().get("state")
        except ValueError as exc:
            raise TranscribeError("Transcription failed; try again or type your message", status=502) from exc
        if state == "ACTIVE":
            return
        if state == "FAILED":
            raise TranscribeError("Audio could not be read; try again or type your message", status=502)
        if time.monotonic() >= deadline:
            raise TranscribeError("Audio is still processing; try again in a moment", status=502)
        time.sleep(ACTIVE_POLL_SECONDS)


def _generate(client: httpx.Client, key: str, file_uri: str, mime_type: str) -> dict:
    """Transcribe the uploaded file; returns the raw generateContent payload."""
    try:
        response = client.post(
            f"{API_BASE}/models/{TRANSCRIBE_MODEL}:generateContent",
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"fileData": {"fileUri": file_uri, "mimeType": mime_type}}]}],
                "generationConfig": {"audioTranscriptionConfig": {"mode": "SMART"}},
            },
            timeout=GENERATE_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise TranscribeError(f"Transcription failed: {exc}", status=502) from exc
    if response.status_code >= 400:
        raise TranscribeError("Transcription failed; try again or type your message instead", status=502)
    try:
        return response.json()
    except ValueError as exc:
        raise TranscribeError("Transcription failed; try again or type your message instead", status=502) from exc


def _delete_file(client: httpx.Client, key: str, name: str) -> None:
    """Remove the Files API copy; best-effort so cleanup never fails a transcript."""
    try:
        client.delete(f"{API_BASE}/{name}", headers={"x-goog-api-key": key}, timeout=UPLOAD_TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        logger.warning("Could not delete transcribed voice file %s: %s", name, exc)


def transcribe_audio(data: bytes, content_type: str | None, filename: str | None = None) -> str:
    """Transcribe one recorded clip; raises TranscribeError on any failure."""
    if not data:
        raise TranscribeError("No audio received; record a short message and try again", status=422)
    if len(data) > MAX_AUDIO_BYTES:
        raise TranscribeError("Voice clip is too long; keep recordings under 3 minutes", status=413)
    mime_type = normalize_mime_type(content_type, filename)
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if len(key) < 16:
        raise TranscribeError(
            "Voice dictation needs a Gemini key; add GEMINI_API_KEY to the server .env and restart",
            status=401,
        )
    with httpx.Client() as client:
        file_uri, file_name = _upload_audio(client, key, data, mime_type)
        try:
            _await_active(client, key, file_name)
            payload = _generate(client, key, file_uri, mime_type)
        finally:
            _delete_file(client, key, file_name)
    text = extract_transcript(payload)
    if not text:
        blocked = (payload.get("promptFeedback") or {}).get("blockReason")
        if blocked:
            raise TranscribeError("That clip was blocked; try rephrasing or type your message", status=502)
        raise TranscribeError("No speech detected; try again or type your message instead", status=502)
    return text
