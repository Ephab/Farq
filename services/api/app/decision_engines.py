"""System One decision engines behind one fallback chain: Jev -> Span-01 Lite -> Laya.

All three speak the typed-decisions format ({state, questions} -> {answers}):
- Jev: TypeSafe cloud (TYPESAFE_AI_API_KEY).
- Span-01 Lite: Respan via OpenRouter's /systemone (OPENROUTER_API_KEY). It is a
  behavior scorer that answers only `noul` questions, so `choice` and `score`
  questions are rewritten into nouls and folded back into the same answer shape.
- Laya: local checkpoint, shared with the email classifier; nothing leaves the machine.

Callers pass already-redacted text. Keys stay server-side; nothing here persists input.
"""
from __future__ import annotations

import importlib.util
import os
import threading
from dataclasses import dataclass
from typing import Callable

import httpx

JEV_URL = "https://api.typesafe.ai/v1/systemone"
OPENROUTER_URL = "https://openrouter.ai/api/v1/systemone"
CHAIN = ("jev", "span", "laya")
CLOUD = {"jev", "span"}
# The student-facing switch: "jev" = cloud engines only (Laya is never loaded, so no local CPU use),
# "laya" = local only (nothing leaves the machine), "auto" = the full chain.
ENGINE_MODES = {"auto": CHAIN, "jev": ("jev", "span"), "laya": ("laya",)}
SETTING_KEY = "decision_engine"
def engine_choice() -> str:
    """Current switch value: persisted in app_settings, else DECISION_ENGINE in the environment, else auto."""
    from .app_settings import get_setting

    value = get_setting(SETTING_KEY) or os.getenv("DECISION_ENGINE", "").strip().lower()
    return value if value in ENGINE_MODES else "auto"


def set_engine_choice(value: str) -> str:
    """Persist the switch; takes effect on the next decision without a restart."""
    from .app_settings import set_setting

    if value not in ENGINE_MODES:
        raise ValueError("engine must be one of: " + ", ".join(ENGINE_MODES))
    set_setting(SETTING_KEY, value)
    return value


def laya_loaded() -> bool:
    """True only if the local model is actually in memory (never loads it)."""
    return _laya is not None and getattr(_laya, "_agent", None) is not None


def active_chain() -> tuple[str, ...]:
    return ENGINE_MODES[engine_choice()]


class EngineUnavailable(RuntimeError):
    """Engine not configured, failed, or returned an unusable answer."""


def _flag(name: str) -> bool:
    return os.getenv(name, "true").lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class EngineInfo:
    id: str
    label: str
    provider: str
    location: str  # "local" | "cloud"
    model: str
    available: bool
    reason: str


def jev_info() -> EngineInfo:
    key = bool(os.getenv("TYPESAFE_AI_API_KEY", "").strip())
    available = key and _flag("JEV_ENABLED")
    reason = "" if available else ("Set JEV_ENABLED=true on the server." if key else "Add TYPESAFE_AI_API_KEY on the server.")
    return EngineInfo("jev", "Jev", "TypeSafe", "cloud", os.getenv("JEV_MODEL", "jev-latest"), available, reason)


def span_info() -> EngineInfo:
    key = bool(os.getenv("OPENROUTER_API_KEY", "").strip())
    available = key and _flag("SPAN_ENABLED")
    reason = "" if available else ("Set SPAN_ENABLED=true on the server." if key else "Add OPENROUTER_API_KEY on the server.")
    return EngineInfo("span", "Span-01 Lite", "Respan via OpenRouter", "cloud",
                      os.getenv("SPAN_MODEL", "respan/span-01-lite"), available, reason)


def laya_info() -> EngineInfo:
    from .email_classifier import MODEL_ID, ClassifierUnavailable, model_directory

    reason = ""
    if importlib.util.find_spec("laya") is None or importlib.util.find_spec("huggingface_hub") is None:
        reason = "Laya is not installed. Run setup.bat or bash setup.sh."
    else:
        try:
            model_directory()  # local cache check only; never downloads
        except ClassifierUnavailable as error:
            reason = str(error)
    return EngineInfo("laya", "Laya", "On this computer", "local", MODEL_ID, not reason, reason)


INFO: dict[str, Callable[[], EngineInfo]] = {"jev": jev_info, "span": span_info, "laya": laya_info}


def engines_status() -> list[dict]:
    """Every engine with `selected` = whether the current switch allows it to run."""
    allowed = active_chain()
    return [{**INFO[name]().__dict__, "selected": name in allowed} for name in CHAIN]


def chain_from(preferred: str) -> tuple[str, ...]:
    """The chain starting at the preferred engine: jev -> (jev, span, laya), span -> (span, laya).

    The engine switch only narrows this at call time (see classify_email); the shape stays fixed here.
    """
    return CHAIN[CHAIN.index(preferred):] if preferred in CHAIN else CHAIN


def _post(url: str, key: str, body: dict, timeout: float) -> dict:
    response = httpx.post(url, headers={"Authorization": f"Bearer {key}"}, json=body, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("answers"), dict):
        raise ValueError("missing answers")
    return payload


def _ask_jev(state: str, questions: dict, timeout: float) -> dict:
    info = jev_info()
    payload = _post(JEV_URL, os.environ["TYPESAFE_AI_API_KEY"], {"state": state, "model": info.model, "questions": questions}, timeout)
    payload.setdefault("model", info.model)
    return payload


def span_questions(questions: dict) -> dict[str, dict]:
    """Rewrite typed questions as Span nouls. `criteria` stays absent: Span rejects null."""
    nouls: dict[str, dict] = {}
    for qid, question in questions.items():
        kind, text, criteria = question.get("type"), question.get("instructions", ""), question.get("criteria")
        if kind == "choice":
            for key, meaning in criteria.items():
                nouls[f"{qid}::{key}"] = {"type": "noul", "instructions": f"{text}. The answer is: {meaning}"}
        elif kind == "score":
            nouls[f"{qid}::score"] = {"type": "noul", "instructions": f"{text} Yes means closer to '{criteria[-1]}' than to '{criteria[0]}'."}
        else:
            nouls[qid] = {"type": "noul", "instructions": text}
    return nouls


def span_answers(questions: dict, raw: dict) -> dict[str, dict]:
    """Fold Span's per-noul probabilities back into choice/score/noul answers."""
    def p(key: str) -> float:
        value = (raw.get(key) or {}).get("noul")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ValueError("invalid noul")
        return float(value)

    answers: dict[str, dict] = {}
    for qid, question in questions.items():
        kind, criteria = question.get("type"), question.get("criteria")
        if kind == "choice":
            scores = {key: p(f"{qid}::{key}") for key in criteria}
            total = sum(scores.values()) or 1.0
            probabilities = {key: value / total for key, value in scores.items()}
            choice = max(probabilities, key=probabilities.get)
            answers[qid] = {"type": "choice", "choice": choice, "probabilities": probabilities, "confidence": probabilities[choice]}
        elif kind == "score":
            yes = p(f"{qid}::score")
            answers[qid] = {"type": "score", "score": yes * (len(criteria) - 1), "confidence": max(yes, 1 - yes)}
        else:
            yes = p(qid)
            answers[qid] = {"type": "noul", "noul": yes, "confidence": max(yes, 1 - yes)}
    return answers


def _ask_span(state: str, questions: dict, timeout: float) -> dict:
    info = span_info()
    payload = _post(OPENROUTER_URL, os.environ["OPENROUTER_API_KEY"],
                    {"state": state, "model": info.model, "questions": span_questions(questions)}, timeout)
    return {"model": payload.get("model") or info.model, "answers": span_answers(questions, payload["answers"]),
            "usage": payload.get("usage") or {}}


_laya = None
_laya_lock = threading.Lock()


def shared_laya():
    """One Laya model per process, shared by email sync and the decision gate."""
    global _laya
    with _laya_lock:
        if _laya is None:
            from .email_classifier import EmailClassifier
            _laya = EmailClassifier()
        return _laya


def _ask_laya(state: str, questions: dict, timeout: float) -> dict:
    from .email_classifier import MODEL_ID
    payload = shared_laya().system_one(state, questions)
    if not isinstance(payload, dict) or not isinstance(payload.get("answers"), dict):
        raise ValueError("missing answers")
    return {"model": MODEL_ID, "answers": payload["answers"], "usage": payload.get("usage") or {}}


ASK: dict[str, Callable[[str, dict, float], dict]] = {"jev": _ask_jev, "span": _ask_span, "laya": _ask_laya}
TIMEOUTS = {"jev": ("JEV_TIMEOUT_SECONDS", "5"), "span": ("SPAN_TIMEOUT_SECONDS", "10"), "laya": ("", "0")}


@dataclass(frozen=True)
class ChainResult:
    engine: str
    payload: dict
    failures: tuple[tuple[str, str], ...]  # (engine, error category) for engines that were tried and failed


def error_category(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException): return "timeout"
    if isinstance(exc, httpx.HTTPStatusError): return f"http_{exc.response.status_code}"
    if isinstance(exc, httpx.HTTPError): return "network"
    return "invalid_response"


def ask_chain(state: str, questions: dict, order: tuple[str, ...] | None = None) -> ChainResult:
    """First engine in `order` that is configured, allowed by the engine switch and answers wins."""
    allowed = active_chain()
    order = tuple(name for name in (order or CHAIN) if name in allowed)
    failures: list[tuple[str, str]] = []
    for name in order:
        if not INFO[name]().available:
            continue
        variable, default = TIMEOUTS[name]
        try:
            payload = ASK[name](state, questions, float(os.getenv(variable, default)) if variable else 0)
        except Exception as exc:
            # Never log exc itself: provider messages can echo private input.
            failures.append((name, error_category(exc)))
            continue
        return ChainResult(name, payload, tuple(failures))
    raise EngineUnavailable(",".join(f"{name}:{error}" for name, error in failures) or "no_engine_available")


EMAIL_TEXT_CHARS = 8000


def _cloud_email(result: ChainResult, failures: list[tuple[str, str]]):
    from .email_classifier import QUESTIONS, EmailClassification, _probability

    answers = result.payload["answers"]
    category = answers["category"]["choice"]
    if category not in QUESTIONS["category"]["criteria"]:
        raise ValueError("unknown category")
    raw = answers["category"].get("probabilities") or {category: answers["category"].get("confidence", 1.0)}
    probabilities = {key: _probability(value) for key, value in raw.items() if key in QUESTIONS["category"]["criteria"]}
    values = [_probability(answers[name]["noul"]) for name in ("important", "action_required", "time_sensitive", "lasting_relevance")]
    reasons = ("uncalibrated_email_domain", f"engine_{result.engine}") + tuple(f"fallback_from_{name}" for name, _ in failures)
    return EmailClassification(category, probabilities, *values, reasons, 1, "cloud",
                               model_id=str(result.payload.get("model") or result.engine)[:120], model_revision="")


def classify_email(email, preferred: str, laya):
    """Classify with the student's chosen engine, then fall back down the chain to Laya.

    Cloud engines get redacted, capped subject/body; Laya (`laya.classify`) keeps its own
    windowing and language checks, and raises ClassifierUnavailable if it cannot run.
    """
    from dataclasses import replace
    from .decisions import redact_text
    from .email_classifier import QUESTIONS, clean_email_body

    failures: list[tuple[str, str]] = []
    allowed = active_chain()
    cloud = [name for name in chain_from(preferred) if name in CLOUD and name in allowed and INFO[name]().available]
    if cloud:
        # redact_text also collapses whitespace, so the body joins the subject on one line.
        state = redact_text(f"Subject: {email.subject}\n\n{clean_email_body(email.body)}", limit=EMAIL_TEXT_CHARS)
        for name in cloud:
            try:
                return _cloud_email(ask_chain(state, QUESTIONS, (name,)), failures)
            except EngineUnavailable as error:
                failures.append((name, str(error).split(":", 1)[-1]))
            except (KeyError, TypeError, ValueError):
                failures.append((name, "invalid_response"))
    if "laya" not in allowed:
        # Cloud-only mode: never load the local model, even as a last resort.
        from .email_classifier import ClassifierUnavailable
        raise ClassifierUnavailable("Cloud-only mode is on and no cloud engine answered. Check Models & connections.")
    classification = laya.classify(email)
    if failures:
        classification = replace(classification, review_reasons=classification.review_reasons + tuple(f"fallback_from_{name}" for name, _ in failures))
    return classification
