import json

import httpx
import pytest

from app.database import Base, SessionLocal, engine
from app.decisions import DecisionItem, observe_items, redact_text, rerank, status
from app.models import DecisionRecord


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    session = SessionLocal()
    session.query(DecisionRecord).delete()
    session.commit()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def test_redaction_removes_private_and_secret_values():
    clean = redact_text("mail me at student@iau.edu.sa or +966512345678 token=abc123 student 2240005747")
    assert "student@iau.edu.sa" not in clean
    assert "512345678" not in clean
    assert "abc123" not in clean
    assert "2240005747" not in clean


def test_disabled_gateway_is_fail_open(db, monkeypatch):
    monkeypatch.delenv("TYPESAFE_AI_API_KEY", raising=False)
    assert observe_items(db, [DecisionItem("telegram", "1", "Co-op", "Apply now")]) == []
    assert db.query(DecisionRecord).count() == 0


def test_successful_shadow_decision_is_persisted_without_source_text(db, monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", "test-key")
    monkeypatch.setenv("JEV_MODE", "shadow")
    payload = {
        "model": "jev-1.13.0",
        "answers": {
            "item_0_category": {"type": "choice", "choice": "coop_opportunity", "confidence": .98},
            "item_0_actionable": {"type": "noul", "noul": .95},
            "item_0_urgency": {"type": "score", "score": 2.2, "confidence": .7},
            "item_0_roadmap": {"type": "score", "score": 2.7, "confidence": .8},
        },
        "usage": {"input_tokens": 100, "output_tokens": 20},
    }
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: httpx.Response(200, json=payload, request=httpx.Request("POST", "https://api.typesafe.ai")))
    records = observe_items(db, [DecisionItem("telegram", "42", "AI co-op", "Secret source body")], "coop_ingestion")
    assert records[0].status == "shadow"
    assert json.loads(records[0].answers_json)["category"]["choice"] == "coop_opportunity"
    assert "Secret source body" not in records[0].answers_json
    assert records[0].input_tokens == 100


def test_timeout_is_recorded_and_does_not_raise(db, monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: (_ for _ in ()).throw(httpx.ReadTimeout("slow")))
    records = observe_items(db, [DecisionItem("outlook", "m1", "Subject", "Body")], "outlook_ingestion")
    assert records[0].status == "error"
    assert records[0].error_category == "timeout"
    assert status(db)["state"] == "degraded"


def test_rerank_changes_order_only_when_purpose_is_active(db, monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", "test-key")
    monkeypatch.setenv("JEV_MODE", "active")
    monkeypatch.setenv("JEV_ACTIVE_PURPOSES", "coop_rerank")
    payload = {
        "model": "jev-1.13.0",
        "answers": {
            "item_0_roadmap": {"type": "score", "score": .4, "confidence": .9},
            "item_1_roadmap": {"type": "score", "score": 2.8, "confidence": .9},
        },
        "usage": {},
    }
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: httpx.Response(200, json=payload, request=httpx.Request("POST", "https://api.typesafe.ai")))
    values = [{"id": "first", "title": "Weak"}, {"id": "second", "title": "Strong"}]
    assert [item["id"] for item in rerank(db, values, "coop_rerank")] == ["second", "first"]


def test_rerank_preserves_order_in_shadow_mode(db, monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", "test-key")
    monkeypatch.setenv("JEV_MODE", "shadow")
    monkeypatch.setenv("JEV_ACTIVE_PURPOSES", "coop_rerank")
    payload = {"model": "jev-1.13.0", "answers": {}, "usage": {}}
    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: httpx.Response(200, json=payload, request=httpx.Request("POST", "https://api.typesafe.ai")))
    values = [{"id": "first", "title": "First"}, {"id": "second", "title": "Second"}]
    assert rerank(db, values, "coop_rerank") == values
