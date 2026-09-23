from __future__ import annotations

"""Quiz generation through the local Hermes gateway.

The browser never calls a model provider directly. This module sends a
JSON-only quiz prompt to ``POST /v1/runs`` and polls the durable run, using a
throwaway ``farq:quiz:*`` session so slide content never pollutes the coach's
conversational memory. Nothing is written to SQLite: quiz source text is not
an explicit student statement, so it must not become a StudentFact, message,
or proposal.

The model returns raw text; the frontend keeps the battle-tested
parse/salvage logic and turns it into UI-ready questions.
"""

import time
import uuid

import httpx

from .hermes import (
    HERMES_URL,
    effective_hermes_key,
    raise_for_gateway_status,
    resolve_hermes_selection,
)

MAX_SOURCE_CHARS = 12_000
RUN_TIMEOUT_SECONDS = 180
POLL_INTERVAL_SECONDS = 2

QUIZ_INSTRUCTIONS = " ".join([
    "You generate study quizzes from lecture slides.",
    "Do not call any tools. Return ONLY a JSON object: {\"questions\": [...]}. No markdown, no prose.",
    "Each question: {\"id\":\"q1\",\"type\":\"mcq|true_false|short_answer\",\"question\":\"...\",\"options\":[...],\"answer\":\"...\",\"explanation\":\"one sentence\",\"source\":\"Slide N or Page N\"}.",
    "Rules: mcq has exactly 4 distinct options with answer matching one option verbatim.",
    "true_false answer is exactly \"True\" or \"False\".",
    "short_answer has no options field and a concise reference answer.",
    "Explanations reference the slide content. No trick questions beyond the material.",
])


class QuizRunError(RuntimeError):
    """Quiz generation failure with the HTTP status the API should return."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def _type_list(types: list[str]) -> str:
    names = {
        "mcq": "multiple-choice (4 options, exactly 1 correct)",
        "true_false": "true/false",
        "short_answer": "short-answer (1-2 sentence reference answer)",
    }
    return ", ".join(names[t] for t in types)


def build_quiz_input(source_text: str, count: int, difficulty: str, types: list[str]) -> str:
    source = source_text[:MAX_SOURCE_CHARS]
    return "\n".join([
        f"Generate {count} questions. Difficulty: {difficulty}.",
        f"Question types to mix: {_type_list(types)}.",
        "Distribute types evenly across the set.",
        "",
        "--- SLIDE TEXT START ---",
        source,
        "--- SLIDE TEXT END ---",
    ])


def run_quiz(
    source_text: str,
    count: int,
    difficulty: str,
    types: list[str],
    provider: str | None = None,
    model: str | None = None,
    hermes_api_key: str | None = None,
) -> dict:
    gateway_key = effective_hermes_key(hermes_api_key)
    if len(gateway_key) < 16:
        raise QuizRunError(
            "Farq Hermes key is missing or too short; press Apply in Settings "
            "or set HERMES_API_KEY in the server .env",
            status=401,
        )
    try:
        quiz_model, quiz_provider = resolve_hermes_selection(provider, model)
    except ValueError as exc:
        raise QuizRunError(str(exc), status=422) from exc
    session_id = f"quiz-{uuid.uuid4().hex[:12]}"
    headers = {
        "Authorization": f"Bearer {gateway_key}",
        "Idempotency-Key": f"quiz-{session_id}",
        "X-Hermes-Session-Key": f"farq:quiz:{session_id}",
    }
    payload = {
        "input": build_quiz_input(source_text, count, difficulty, types),
        "session_id": session_id,
        "instructions": QUIZ_INSTRUCTIONS,
        "model": quiz_model,
        "provider": quiz_provider,
    }
    try:
        with httpx.Client(timeout=20) as client:
            try:
                response = client.post(f"{HERMES_URL}/v1/runs", headers=headers, json=payload)
                raise_for_gateway_status(response)
            except RuntimeError as exc:
                # 401 already carries an actionable message.
                raise QuizRunError(str(exc), status=401) from exc
            run_id = response.json()["run_id"]
            deadline = time.monotonic() + RUN_TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                poll = client.get(f"{HERMES_URL}/v1/runs/{run_id}", headers=headers)
                raise_for_gateway_status(poll)
                state = poll.json()
                status = state.get("status")
                if status == "completed":
                    output = (state.get("output") or "").strip()
                    if not output:
                        raise QuizRunError("Hermes returned an empty answer — try fewer questions", status=502)
                    return {"output": output, "model": quiz_model, "provider": quiz_provider}
                if status in {"failed", "cancelled"}:
                    raise QuizRunError(state.get("error") or f"Hermes run {status}", status=502)
                time.sleep(POLL_INTERVAL_SECONDS)
            raise QuizRunError("Hermes did not finish within 180 seconds", status=504)
    except QuizRunError:
        raise
    except httpx.HTTPError as exc:
        raise QuizRunError(f"Hermes gateway unavailable: {exc}", status=502) from exc
