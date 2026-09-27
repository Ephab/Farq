from __future__ import annotations

"""Fail-open TypeSafe/Jev decision layer.

Jev observes narrow, redacted states. It never writes product state, creates a
StudentFact, or talks to Hermes directly. Callers keep their deterministic
behavior unless a purpose is explicitly activated after evaluation.
"""

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Iterable

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import DecisionRecord

API_URL = "https://api.typesafe.ai/v1/systemone"
QUESTION_SET_VERSION = "farq-v1"
MAX_ITEMS = 8
MAX_TEXT_CHARS = 1600
RERANK_PURPOSES = {"coop_rerank", "hackathon_rerank", "blackboard_rerank"}

_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<!\d)(?:\+?966|0)?5\d{8}(?!\d)")
_LONG_ID = re.compile(r"(?<!\d)\d{8,}(?!\d)")
_SECRET = re.compile(r"(?i)\b(?:bearer\s+\S+|(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+)")

CATEGORY_CRITERIA = {
    "academic_deadline": "A confirmed academic assessment, submission, or deadline",
    "learning_resource": "Material useful for learning without a confirmed deadline",
    "coop_opportunity": "A confirmed internship, employment, or cooperative training opportunity",
    "event_opportunity": "A confirmed event, workshop, competition, or hackathon",
    "student_evidence": "Evidence about the student's skills, courses, projects, or achievements",
    "casual_or_noise": "Casual, promotional, duplicate, uncertain, or non-actionable content",
}

INTENT_CRITERIA = {
    "roadmap": "Planning or modifying what the student should learn",
    "course_content": "Understanding course material or finding learning resources",
    "deadlines": "Assessments, due dates, schedules, or reminders",
    "coop": "Companies, internships, cooperative training, or applications",
    "opportunities": "Hackathons, events, workshops, or competitions",
    "projects": "Project ideas, refinement, submission, or evaluation",
    "general_coaching": "General advice or conversation not covered by another route",
}


def enabled() -> bool:
    return bool(os.getenv("TYPESAFE_AI_API_KEY", "").strip()) and os.getenv("JEV_ENABLED", "true").lower() in {"1", "true", "yes"}


def mode() -> str:
    value = os.getenv("JEV_MODE", "shadow").strip().lower()
    return value if value in {"off", "shadow", "active"} else "shadow"


def active_purposes() -> set[str]:
    return {part.strip() for part in os.getenv("JEV_ACTIVE_PURPOSES", "").split(",") if part.strip()}


def redact_text(value: object) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()[:MAX_TEXT_CHARS]
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    text = _LONG_ID.sub("[id]", text)
    return _SECRET.sub("[secret]", text)


@dataclass(frozen=True)
class DecisionItem:
    entity_type: str
    entity_id: str
    title: str
    text: str
    student_id: str | None = None


def _fingerprint(purpose: str, items: list[DecisionItem]) -> str:
    material = json.dumps({
        "purpose": purpose,
        "version": QUESTION_SET_VERSION,
        "model": os.getenv("JEV_MODEL", "jev-latest"),
        "items": [{"type": i.entity_type, "id": i.entity_id, "title": redact_text(i.title), "text": redact_text(i.text)} for i in items],
    }, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()


def _questions(count: int, purpose: str) -> dict[str, dict]:
    if purpose == "chat_intent":
        return {"item_0_intent": {"type": "choice", "instructions": "Route this student request to one Farq capability", "criteria": INTENT_CRITERIA}}
    questions: dict[str, dict] = {}
    for index in range(count):
        questions[f"item_{index}_category"] = {"type": "choice", "instructions": f"Classify item {index}", "criteria": CATEGORY_CRITERIA}
        questions[f"item_{index}_actionable"] = {"type": "noul", "instructions": f"Item {index} contains a concrete action the student can take now"}
        questions[f"item_{index}_urgency"] = {"type": "score", "instructions": f"How urgently should the student see item {index}?", "criteria": ["Store silently", "Weekly summary", "Dashboard soon", "Notify immediately"]}
        questions[f"item_{index}_roadmap"] = {"type": "score", "instructions": f"How useful is item {index} for adapting the student's learning roadmap?", "criteria": ["Not useful", "Slightly useful", "Useful", "Very useful"]}
    return questions


def _error_category(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException): return "timeout"
    if isinstance(exc, httpx.HTTPStatusError): return f"http_{exc.response.status_code}"
    if isinstance(exc, httpx.HTTPError): return "network"
    return "invalid_response"


def _store(db: Session, items: list[DecisionItem], purpose: str, fingerprint: str, payload: dict | None, latency: int | None, error: str | None) -> list[DecisionRecord]:
    answers = payload.get("answers", {}) if payload else {}
    usage = payload.get("usage", {}) if payload else {}
    records = []
    for index, item in enumerate(items):
        prefix = f"item_{index}_"
        item_answers = {key[len(prefix):]: value for key, value in answers.items() if key.startswith(prefix)}
        record = DecisionRecord(
            student_id=item.student_id, purpose=purpose, question_set_version=QUESTION_SET_VERSION,
            entity_type=item.entity_type[:48], entity_id=item.entity_id[:200],
            model=str((payload or {}).get("model") or os.getenv("JEV_MODEL", "jev-latest"))[:80],
            mode=mode(), status="error" if error else ("applied" if mode() == "active" and purpose in active_purposes() and purpose in RERANK_PURPOSES else "shadow"),
            request_fingerprint=fingerprint, answers_json=json.dumps(item_answers, ensure_ascii=False),
            latency_ms=latency, input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"), error_category=error,
        )
        db.add(record); records.append(record)
    db.flush()
    return records


def observe_items(db: Session, items: Iterable[DecisionItem], purpose: str = "ingestion") -> list[DecisionRecord]:
    batch = list(items)[:MAX_ITEMS]
    if not batch or not enabled() or mode() == "off": return []
    fingerprint = _fingerprint(purpose, batch)
    cached = db.scalars(select(DecisionRecord).where(
        DecisionRecord.request_fingerprint == fingerprint,
        DecisionRecord.purpose == purpose,
        DecisionRecord.status != "error",
    )).all()
    if cached:
        by_entity = {(record.entity_type, record.entity_id): record for record in cached}
        ordered = [by_entity.get((item.entity_type[:48], item.entity_id[:200])) for item in batch]
        if all(ordered):
            return [record for record in ordered if record is not None]
    state = {"items": [{"id": index, "title": redact_text(item.title), "content": redact_text(item.text)} for index, item in enumerate(batch)]}
    body = {"state": json.dumps(state, ensure_ascii=False), "model": os.getenv("JEV_MODEL", "jev-latest"), "questions": _questions(len(batch), purpose)}
    timeout = float(os.getenv("JEV_TIMEOUT_SECONDS", "5"))
    started = time.perf_counter()
    error = None; payload = None
    try:
        response = httpx.post(API_URL, headers={"Authorization": f"Bearer {os.environ['TYPESAFE_AI_API_KEY']}"}, json=body, timeout=timeout)
        response.raise_for_status(); payload = response.json()
        if not isinstance(payload.get("answers"), dict): raise ValueError("missing answers")
    except Exception as exc:
        error = _error_category(exc)
        if error in {"timeout", "network", "http_429", "http_500", "http_502", "http_503", "http_504"}:
            try:
                response = httpx.post(API_URL, headers={"Authorization": f"Bearer {os.environ['TYPESAFE_AI_API_KEY']}"}, json=body, timeout=timeout)
                response.raise_for_status(); payload = response.json(); error = None
            except Exception as retry_exc: error = _error_category(retry_exc)
    latency = round((time.perf_counter() - started) * 1000)
    return _store(db, batch, purpose, fingerprint, payload, latency, error)


def observe_independently(items: Iterable[DecisionItem], purpose: str = "ingestion") -> None:
    """Best-effort observation for read paths; never changes the caller's transaction."""
    db = SessionLocal()
    try:
        observe_items(db, items, purpose); db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def rerank(db: Session, values: list[dict], purpose: str, *, student_id: str | None = None) -> list[dict]:
    """Observe a deterministic shortlist and optionally reorder it.

    Reordering is enabled only for an explicitly activated purpose. Items with
    missing or low-confidence scores keep their original relative position.
    """
    if not values:
        return values
    items = [DecisionItem(
        entity_type=purpose,
        entity_id=str(value.get("id") or value.get("external_id") or index),
        title=str(value.get("title") or value.get("name") or "Candidate"),
        text=json.dumps(value, ensure_ascii=False, default=str),
        student_id=student_id,
    ) for index, value in enumerate(values[:MAX_ITEMS])]
    records = observe_items(db, items, purpose)
    # Retrieval functions run under GET dependencies, which otherwise close
    # without committing their audit observations.
    if records:
        db.commit()
    if mode() != "active" or purpose not in active_purposes() or len(records) != len(items):
        return values
    scored: list[tuple[float, int, dict]] = []
    for index, value in enumerate(values[:MAX_ITEMS]):
        try:
            answer = json.loads(records[index].answers_json).get("roadmap", {})
            confidence = float(answer.get("confidence", 0))
            score = float(answer.get("score", 0)) if confidence >= .70 else -1
        except (TypeError, ValueError, json.JSONDecodeError):
            score = -1
        scored.append((score, index, value))
    ranked = [value for _score, _index, value in sorted(scored, key=lambda row: (-row[0], row[1]))]
    return ranked + values[MAX_ITEMS:]


def status(db: Session) -> dict:
    latest = db.scalar(select(DecisionRecord).order_by(DecisionRecord.created_at.desc()))
    success = db.scalar(select(DecisionRecord).where(DecisionRecord.status != "error").order_by(DecisionRecord.created_at.desc()))
    failure = db.scalar(select(DecisionRecord).where(DecisionRecord.status == "error").order_by(DecisionRecord.created_at.desc()))
    configured = enabled()
    state = "disabled" if not configured or mode() == "off" else "degraded" if latest and latest.status == "error" else "active" if mode() == "active" else "observing"
    return {
        "state": state, "enabled": configured, "mode": mode(), "model": os.getenv("JEV_MODEL", "jev-latest"),
        "active_purposes": sorted(active_purposes()),
        "last_success_at": success.created_at.isoformat() if success else None,
        "last_failure_at": failure.created_at.isoformat() if failure else None,
        "last_error": failure.error_category if failure else None,
    }
