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

from .hermes import LAST_JSON_MODEL, HermesJsonError, effective_hermes_key, run_json_prompt

MAX_SOURCE_CHARS = 12_000
RUN_TIMEOUT_SECONDS = 180

QUIZ_INSTRUCTIONS = " ".join([
    "You generate study quizzes from lecture slides.",
    "Load the farq-quiz skill and follow it.",
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
        output = run_json_prompt(
            "quiz",
            build_quiz_input(source_text, count, difficulty, types),
            QUIZ_INSTRUCTIONS,
            provider,
            model,
            hermes_api_key,
            RUN_TIMEOUT_SECONDS,
        )
    except HermesJsonError as exc:
        message = "Hermes returned an empty answer — try fewer questions" if "empty answer" in str(exc) else str(exc)
        raise QuizRunError(message, status=exc.status) from exc
    used_model, used_provider = LAST_JSON_MODEL["quiz"]
    return {"output": output, "model": used_model, "provider": used_provider}
