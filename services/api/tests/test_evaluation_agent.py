import json
import pytest
from pydantic import ValidationError
from app import evaluation_agent as agent
from app.schemas import EvaluationAction, EvaluationReasonRequest

BRIEF = {"title": "Tool harness", "deliverables": ["Tool registry"], "rubric": [{"id": "correctness", "weight": 75}, {"id": "docs", "weight": 25}]}

def body(phase="review"):
    return EvaluationReasonRequest(lease_token="x"*24, phase=phase, context="source",
        observations=[{"id":"check-1","title":"Real test","kind":"node_cli","passed":True,"output":"ok","duration_ms":10}])

def review():
    return {"brief_title":"Tool harness","requirements_assessed":["Tool registry"],"summary":"Observed review","coverage":"medium","criteria":[
        {"criterion_id":"correctness","score":80,"evidence":["check-1"],"feedback":"Passes observed behavior"},
        {"criterion_id":"docs","score":40,"evidence":["check-1"],"feedback":"Missing reproduction details"}]}

def test_review_computes_weighted_score_from_specific_criteria(monkeypatch):
    monkeypatch.setattr(agent, "run_json_prompt", lambda *a, **kw: json.dumps(review()))
    assert agent.reason(body(), BRIEF)["review"]["score"] == 70

@pytest.mark.parametrize("change", ["unknown_evidence", "missing_criterion", "duplicate_criterion"])
def test_review_rejects_fabricated_citations_and_invalid_rubric(monkeypatch, change):
    result = review()
    if change == "unknown_evidence": result["criteria"][0]["evidence"] = ["check-999"]
    if change == "missing_criterion": result["criteria"].pop()
    if change == "duplicate_criterion": result["criteria"][1]["criterion_id"] = "correctness"
    monkeypatch.setattr(agent, "run_json_prompt", lambda *a, **kw: json.dumps(result))
    with pytest.raises(ValueError): agent.reason(body(), BRIEF)

def test_agent_cannot_return_generic_shell_tool():
    with pytest.raises(ValidationError): EvaluationAction(kind="shell", title="bad")

def test_planning_uses_toolless_server_selection(monkeypatch):
    seen = {}
    def call(*args, **kw):
        seen.update(kw)
        assert "UNTRUSTED" in args[2]
        return '{"kind":"node_cli","title":"Run demo","entry":"harness.js","args":["demo"]}'
    monkeypatch.setattr(agent, "run_json_prompt", call)
    assert agent.reason(body("next"), BRIEF)["action"]["kind"] == "node_cli"
    assert seen["direct"] is True
    assert "provider" not in seen and "model" not in seen


def test_wrong_project_review_is_rejected_and_retried(monkeypatch):
    result = review(); result["brief_title"] = "Unrelated YOLO project"
    calls = []
    def answer(*args, **kw):
        calls.append(args[1])
        return json.dumps(result if len(calls) == 1 else review())
    monkeypatch.setattr(agent, "run_json_prompt", answer)
    assert agent.reason(body(), BRIEF)["review"]["score"] == 70
    assert len(calls) == 2 and "PREVIOUS REVIEW REJECTED" in calls[1]


def test_non_http_action_ignores_http_sentinel_fields(monkeypatch):
    monkeypatch.setattr(agent, "run_json_prompt", lambda *a, **kw: '{"kind":"finish","title":"Review evidence","expected_status":0,"method":null,"args":null}')
    assert agent.reason(body("next"), BRIEF)["action"]["kind"] == "finish"
