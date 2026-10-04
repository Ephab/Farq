import httpx
import pytest

from app import decision_engines as engines
from app.email_classifier import QUESTIONS, EmailClassification, EmailInput


def info(name, available=True):
    return lambda: engines.EngineInfo(name, name, "test", "local" if name == "laya" else "cloud", f"{name}-model", available, "" if available else "off")


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", "jev-key")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-key")
    monkeypatch.setenv("JEV_ENABLED", "true")
    monkeypatch.setenv("SPAN_ENABLED", "true")
    monkeypatch.setitem(engines.INFO, "laya", info("laya", False))


def route(monkeypatch, handlers):
    """handlers: url fragment -> callable(body) returning a JSON payload or raising."""
    calls = []
    def post(url, headers=None, json=None, timeout=None):
        calls.append((url, headers, json))
        for fragment, handler in handlers.items():
            if fragment in url:
                return httpx.Response(200, json=handler(json), request=httpx.Request("POST", url))
        raise AssertionError(url)
    monkeypatch.setattr(engines.httpx, "post", post)
    return calls


def span_yes(values):
    return lambda body: {"model": "respan/span-01-lite", "answers": {k: {"type": "noul", "noul": values(k)} for k in body["questions"]}}


def test_chain_order_and_skips():
    assert engines.chain_from("jev") == ("jev", "span", "laya")
    assert engines.chain_from("span") == ("span", "laya")
    assert engines.chain_from("laya") == ("laya",)
    assert engines.chain_from("unknown") == engines.CHAIN


def test_span_questions_are_nouls_without_criteria():
    questions = {
        "cat": {"type": "choice", "instructions": "Pick", "criteria": {"a": "Alpha", "b": "Beta"}},
        "lvl": {"type": "score", "instructions": "How much?", "criteria": ["None", "Some", "Lots"]},
        "yes": {"type": "noul", "instructions": "Is it?"},
    }
    converted = engines.span_questions(questions)
    assert set(converted) == {"cat::a", "cat::b", "lvl::score", "yes"}
    assert all(q["type"] == "noul" and "criteria" not in q for q in converted.values())
    answers = engines.span_answers(questions, {"cat::a": {"noul": .2}, "cat::b": {"noul": .6}, "lvl::score": {"noul": .9}, "yes": {"noul": .1}})
    assert answers["cat"]["choice"] == "b" and answers["cat"]["probabilities"]["b"] == pytest.approx(.75)
    assert answers["lvl"]["score"] == pytest.approx(1.8) and answers["lvl"]["confidence"] == pytest.approx(.9)
    assert answers["yes"] == {"type": "noul", "noul": .1, "confidence": .9}
    with pytest.raises(ValueError):
        engines.span_answers(questions, {"cat::a": {"noul": 2}})


def test_jev_failure_falls_to_span_then_records_failure(monkeypatch):
    calls = []
    def post(url, headers=None, json=None, timeout=None):
        calls.append(url)
        if "typesafe" in url:
            raise httpx.ReadTimeout("slow")
        return httpx.Response(200, json=span_yes(lambda k: .7)(json), request=httpx.Request("POST", url))
    monkeypatch.setattr(engines.httpx, "post", post)
    result = engines.ask_chain("state", {"q": {"type": "noul", "instructions": "?"}})
    assert result.engine == "span" and result.failures == (("jev", "timeout"),)
    assert calls == [engines.JEV_URL, engines.OPENROUTER_URL]
    assert result.payload["answers"]["q"]["noul"] == .7


def test_laya_is_last_resort(monkeypatch):
    monkeypatch.setitem(engines.INFO, "laya", info("laya"))
    monkeypatch.setitem(engines.ASK, "laya", lambda state, questions, timeout: {"model": "laya", "answers": {"q": {"noul": .4}}})
    def post(url, headers=None, json=None, timeout=None):
        return httpx.Response(429, json={}, request=httpx.Request("POST", url))
    monkeypatch.setattr(engines.httpx, "post", post)
    result = engines.ask_chain("state", {"q": {"type": "noul", "instructions": "?"}})
    assert result.engine == "laya" and result.failures == (("jev", "http_429"), ("span", "http_429"))


def test_unconfigured_engines_are_skipped_and_all_failing_raises(monkeypatch):
    monkeypatch.delenv("TYPESAFE_AI_API_KEY")
    calls = route(monkeypatch, {"openrouter": lambda body: (_ for _ in ()).throw(ValueError())})
    with pytest.raises(engines.EngineUnavailable, match="span:"):
        engines.ask_chain("state", {"q": {"type": "noul", "instructions": "?"}})
    assert [url for url, *_ in calls] == [engines.OPENROUTER_URL]


class FakeLaya:
    def __init__(self):
        self.calls = 0
    def classify(self, email):
        self.calls += 1
        return EmailClassification("other", {"other": 1.0}, .1, .1, .1, .1, ("uncalibrated_email_domain",))


def test_email_uses_span_with_redacted_text(monkeypatch):
    calls = route(monkeypatch, {"openrouter": span_yes(lambda k: .9 if k == "category::coursework" else .3)})
    laya = FakeLaya()
    result = engines.classify_email(EmailInput("Exam", "Mail student@uni.edu by Friday"), "span", laya)
    assert result.category == "coursework" and "engine_span" in result.review_reasons
    assert result.model_id == "respan/span-01-lite" and laya.calls == 0
    url, headers, body = calls[0]
    assert headers["Authorization"] == "Bearer or-key"
    assert "student@uni.edu" not in body["state"] and "[email]" in body["state"]
    assert all(q["type"] == "noul" for q in body["questions"].values())


def test_email_laya_choice_never_calls_cloud(monkeypatch):
    calls = route(monkeypatch, {})
    laya = FakeLaya()
    assert engines.classify_email(EmailInput("Exam", "Friday"), "laya", laya).category == "other"
    assert calls == [] and laya.calls == 1


def test_email_falls_back_to_laya_when_cloud_fails(monkeypatch):
    def post(url, headers=None, json=None, timeout=None):
        return httpx.Response(503, json={}, request=httpx.Request("POST", url))
    monkeypatch.setattr(engines.httpx, "post", post)
    laya = FakeLaya()
    result = engines.classify_email(EmailInput("Exam", "Friday"), "jev", laya)
    assert laya.calls == 1
    assert result.review_reasons[-2:] == ("fallback_from_jev", "fallback_from_span")


def test_email_bad_jev_answer_still_tries_span(monkeypatch):
    route(monkeypatch, {"typesafe": lambda body: {"answers": {"category": {"choice": "made-up"}}},
                        "openrouter": span_yes(lambda k: .8 if k == "category::opportunity" else .2)})
    result = engines.classify_email(EmailInput("Internship", "Apply"), "jev", FakeLaya())
    assert result.category == "opportunity"
    assert "engine_span" in result.review_reasons and "fallback_from_jev" in result.review_reasons


@pytest.mark.parametrize("jev_available,jev_fails,span_fails,winner,expected", [
    (True, False, False, "jev", ["jev"]),
    (False, False, False, "span", ["span"]),
    (True, True, False, "span", ["jev", "span"]),
    (True, True, True, "laya", ["jev", "span"]),
])
def test_automatic_email_chain_is_independent_of_roadmap_mode(monkeypatch, jev_available, jev_fails, span_fails, winner, expected):
    monkeypatch.setattr(engines, "active_chain", lambda: ("laya",))
    monkeypatch.setitem(engines.INFO, "jev", info("jev", jev_available))
    calls = []
    def ask(name, fails):
        def answer(state, questions, timeout):
            calls.append(name)
            if fails:
                raise httpx.ReadTimeout("provider timed out")
            return {"model": name, "answers": {
                "category": {"choice": "coursework", "probabilities": {"coursework": 1.0}},
                **{key: {"noul": .7} for key in ("important", "action_required", "time_sensitive", "lasting_relevance")},
            }}
        return answer
    monkeypatch.setitem(engines.ASK, "jev", ask("jev", jev_fails))
    monkeypatch.setitem(engines.ASK, "span", ask("span", span_fails))
    laya = FakeLaya()
    result = engines.classify_email(EmailInput("Exam", "Friday"), "auto", laya)
    assert calls == expected
    assert laya.calls == (1 if winner == "laya" else 0)
    if winner != "laya":
        assert result.model_id == winner
