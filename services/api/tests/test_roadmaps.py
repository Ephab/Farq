import pytest
from pydantic import ValidationError

from app.roadmaps import apply_operations
from app.schemas import RoadmapNode, RoadmapOperation, RoadmapSnapshot, RoadmapStage


def snapshot(status: str = "not-started") -> RoadmapSnapshot:
    return RoadmapSnapshot(
        stages=[RoadmapStage(id="one", title="One", nodeIds=["a", "b"])],
        nodes=[
            RoadmapNode(id="a", stageId="one", title="A", status=status),
            RoadmapNode(id="b", stageId="one", title="B", deps=["a"]),
        ],
    )


def test_adds_future_node_and_keeps_graph_valid():
    result = apply_operations(snapshot(), [RoadmapOperation(
        type="add_node",
        node_id="c",
        node=RoadmapNode(id="c", stageId="one", title="C", deps=["b"]),
    )])
    assert [node.id for node in result.nodes] == ["a", "b", "c"]
    assert result.stages[0].nodeIds[-1] == "c"


def test_protects_completed_history():
    with pytest.raises(ValueError, match="protected"):
        apply_operations(snapshot("done"), [RoadmapOperation(type="update_node", node_id="a", changes={"title": "Changed"})])


def test_rejects_dependency_cycle():
    with pytest.raises(ValidationError, match="acyclic"):
        apply_operations(snapshot(), [RoadmapOperation(type="set_dependencies", node_id="a", dependencies=["b"])])


def test_rejects_identity_or_progress_rewrite():
    with pytest.raises(ValueError, match="Identity and progress"):
        apply_operations(snapshot(), [RoadmapOperation(type="update_node", node_id="a", changes={"status": "done"})])



def test_hugging_face_provider_is_allowlisted():
    import pytest as _pytest

    from app.hermes import HF_MODEL, resolve_hermes_selection

    assert resolve_hermes_selection("hf") == (HF_MODEL, "huggingface")
    assert resolve_hermes_selection("hf", "openai/gpt-oss-20b:groq") == ("openai/gpt-oss-20b:groq", "huggingface")
    with _pytest.raises(ValueError):
        resolve_hermes_selection("hf", "some/unlisted-model")


class _Resp:
    def __init__(self, payload, status_code=200):
        self._payload, self.status_code, self.text = payload, status_code, str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        return None


def test_rate_limit_descends_the_chain_and_cools_down(monkeypatch):
    import app.hermes as hermes

    monkeypatch.setattr(hermes, "_cooldown", {})
    monkeypatch.setattr(hermes.time, "sleep", lambda _s: None)
    tried = []

    class Client:
        def post(self, url, headers=None, json=None):
            tried.append(json["model"])
            return _Resp({"run_id": json["model"]})

        def get(self, url, headers=None):
            model = url.rsplit("/", 1)[1]
            if model in ("gemini-3.8-flash", "gemini-3.7-flash"):
                return _Resp({"status": "failed", "error": "Gemini HTTP 429 (RESOURCE_EXHAUSTED): quota exceeded"})
            return _Resp({"status": "completed", "output": "ok"})

    output, model, provider = hermes.execute_with_fallback(Client(), {"Idempotency-Key": "k"}, {}, "gemini", None, 5)
    assert (output, model, provider) == ("ok", "gemini-3.6-flash", "gemini")
    assert tried == ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]
    # Cooled-down models are skipped on the next run.
    assert hermes.candidate_chain("gemini", None)[0] == ("gemini-3.6-flash", "gemini")


def test_any_model_error_falls_back_but_bad_gateway_key_does_not(monkeypatch):
    import pytest as _pytest

    import app.hermes as hermes

    monkeypatch.setattr(hermes, "_cooldown", {})
    monkeypatch.setattr(hermes.time, "sleep", lambda _s: None)
    tried = []

    class Client:
        def post(self, url, headers=None, json=None):
            tried.append(json["model"])
            return _Resp({"run_id": json["model"]})

        def get(self, url, headers=None):
            model = url.rsplit("/", 1)[1]
            if model == "gemini-3.8-flash":
                return _Resp({"status": "failed", "error": "Gemini HTTP 503 (UNAVAILABLE): high demand"})
            if model == "gemini-3.7-flash":
                return _Resp({"status": "completed", "output": ""})
            return _Resp({"status": "completed", "output": "ok"})

    assert hermes.execute_with_fallback(Client(), {"Idempotency-Key": "k"}, {}, "gemini", None, 5)[1] == "gemini-3.6-flash"
    assert tried == ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"]

    class Unauthorized:
        def post(self, url, headers=None, json=None):
            request = hermes.httpx.Request("POST", url)
            return hermes.httpx.Response(401, request=request)

    with _pytest.raises(RuntimeError, match="401"):
        hermes.execute_with_fallback(Unauthorized(), {"Idempotency-Key": "k"}, {}, "gemini", None, 5)


def test_hugging_face_is_the_last_resort():
    from app.hermes import FALLBACK_CHAIN

    providers = [provider for _model, provider in FALLBACK_CHAIN]
    assert providers.index("huggingface") == len([p for p in providers if p == "gemini"])
    assert FALLBACK_CHAIN[-1][0].startswith("meta-llama/")


def test_busy_gateway_waits_instead_of_skipping_models(monkeypatch):
    import app.hermes as hermes

    monkeypatch.setattr(hermes, "_cooldown", {})
    monkeypatch.setattr(hermes.time, "sleep", lambda _s: None)
    posts = []

    class Client:
        def post(self, url, headers=None, json=None):
            posts.append(json["model"])
            return _Resp({"error": "busy"}, 429) if len(posts) < 3 else _Resp({"run_id": "r"})

        def get(self, url, headers=None):
            return _Resp({"status": "completed", "output": "ok"})

    assert hermes.execute_with_fallback(Client(), {"Idempotency-Key": "k"}, {}, "gemini", None, 30)[1] == "gemini-3.8-flash"
    assert posts == ["gemini-3.8-flash"] * 3
    assert hermes._cooldown == {}
