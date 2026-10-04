from importlib.util import find_spec
from types import SimpleNamespace

import pytest

from app import email_classifier as module
from scripts import setup_local

# The local Laya stack is optional (setup --with-laya).
needs_laya = pytest.mark.skipif(find_spec("laya") is None, reason="local Laya not installed")


@pytest.mark.parametrize("cuda,mps,expected", [(True, True, "cuda"), (False, True, "mps"), (False, False, "cpu")])
def test_device_priority(cuda, mps, expected):
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: cuda),
                            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps)))
    assert module.select_device(torch) == expected


def test_cpu_without_mps_backend():
    torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace())
    assert module.select_device(torch) == "cpu"


@needs_laya
@pytest.mark.parametrize("email,reason", [
    (module.EmailInput("", ""), "empty_input"),
    (module.EmailInput("موعد الاختبار", "غدا", "ar"), "unsupported_language"),
    (module.EmailInput("Deadline", "تسليم الواجب غدا"), "unsupported_language"),
])
def test_unusable_input_never_loads_model(email, reason, monkeypatch):
    classifier = module.EmailClassifier()
    monkeypatch.setattr(classifier, "_load", lambda: pytest.fail("must not load"))
    result = classifier.classify(email)
    assert result.needs_review
    assert result.category is None
    assert result.important_probability is None
    assert result.review_reasons == (reason,)


def fixture_response():
    return {"answers": {
        "category": {"choice": "coursework", "probabilities": {"coursework": 0.8, "administration": 0.1, "opportunity": 0.05, "other": 0.05}},
        **{name: {"noul": 0.9} for name in ("important", "action_required", "time_sensitive", "lasting_relevance")},
    }, "usage": {"windows": 3}}


class WordTokenizer:
    def __call__(self, text, **kwargs):
        return {"input_ids": text.split()}

    def decode(self, ids):
        return " ".join(ids)


def fake_agent(predict):
    return SimpleNamespace(predict_batch=predict, tok=WordTokenizer(),
                           cfg={"max_len": 1024, "head_max_len": 256})


@needs_laya
def test_windowed_classification_is_reviewable_and_does_not_retain_body():
    calls = []
    classifier = module.EmailClassifier()
    classifier._agent = fake_agent(lambda states, *args, **kwargs: calls.append((states, kwargs)) or [fixture_response() for _ in states])
    classifier.device = "cpu"
    result = classifier.classify(module.EmailInput("Exam", "Your final course exam is on Friday. " * 100, "en"))
    assert result.category == "coursework"
    assert result.windows > 1
    assert result.needs_review
    assert "window_aggregation" in result.review_reasons
    assert result.model_revision == module.MODEL_REVISION
    assert calls[0][1] == {"batch_size": 1}
    assert "Your final course exam" not in repr(result)


@needs_laya
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -0.1, 1.1, True, "0.9"])
def test_malformed_model_output_fails_closed(bad):
    response = fixture_response()
    response["answers"]["important"]["noul"] = bad
    classifier = module.EmailClassifier()
    classifier._agent = fake_agent(lambda states, *a, **kw: [response for _ in states])
    with pytest.raises(module.ClassifierUnavailable, match="awaiting review"):
        classifier.classify(module.EmailInput("Exam", "Your exam is on Friday.", "en"))


def test_runtime_never_requests_hub_download(monkeypatch, tmp_path):
    import huggingface_hub
    calls = []
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda **kwargs: calls.append(kwargs) or str(tmp_path))
    with pytest.raises(module.ClassifierUnavailable, match="incomplete"):
        module.model_directory()
    assert calls[0]["local_files_only"] is True
    assert calls[0]["revision"] == module.MODEL_REVISION
    assert calls[0]["token"] is False


@pytest.mark.parametrize("header,extra", [("CUDA Version: 12.8", "cuda"), ("CUDA UMD Version: 13.4", "cuda"), ("CUDA Version: 12.4", "cpu"), ("CUDA Version: N/A", "cpu")])
def test_installer_selects_compatible_wheel(monkeypatch, header, extra):
    monkeypatch.setattr(setup_local.platform, "system", lambda: "Windows")
    monkeypatch.setattr(setup_local.subprocess, "run", lambda *a, **kw: SimpleNamespace(stdout=header))
    assert setup_local.torch_extra() == extra


def test_macos_uses_native_wheel(monkeypatch):
    monkeypatch.setattr(setup_local.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(setup_local.subprocess, "run", lambda *a, **kw: pytest.fail("no nvidia-smi on macOS"))
    assert setup_local.torch_extra() == "cpu"


def test_no_nvidia_driver_uses_cpu(monkeypatch):
    monkeypatch.setattr(setup_local.platform, "system", lambda: "Linux")
    def missing(*args, **kwargs):
        raise FileNotFoundError()
    monkeypatch.setattr(setup_local.subprocess, "run", missing)
    assert setup_local.torch_extra() == "cpu"


@needs_laya
def test_windowing_covers_tail_and_aggregates_late_deadline():
    classifier = module.EmailClassifier()
    seen = []
    def predict(states, *args, **kwargs):
        assert len(states) <= module.WINDOW_BATCH
        seen.extend(states)
        results = []
        for state in states:
            response = fixture_response()
            response["answers"]["time_sensitive"]["noul"] = 0.99 if "DEADLINE" in state else 0.01
            results.append(response)
        return results
    classifier._agent = fake_agent(predict)
    body = "The university has sent this general course information. " * 3000 + "DEADLINE tomorrow."
    result = classifier.classify(module.EmailInput("Course information", body, "en"))
    assert "DEADLINE" in seen[-1]
    assert all(len(window.split()) <= module.WINDOW_TOKENS for window in seen)
    assert result.time_sensitive_probability == 0.99
    assert result.windows == len(seen)
    assert result.windows > 64


@needs_laya
def test_missing_window_output_fails_closed():
    classifier = module.EmailClassifier()
    classifier._agent = fake_agent(lambda *a, **kw: [])
    with pytest.raises(module.ClassifierUnavailable):
        classifier.classify(module.EmailInput("Exam", "The exam is tomorrow.", "en"))


@needs_laya
def test_invalid_category_distribution_fails_closed():
    response = fixture_response()
    response["answers"]["category"]["probabilities"]["other"] = 0.9
    classifier = module.EmailClassifier()
    classifier._agent = fake_agent(lambda *a, **kw: [response])
    with pytest.raises(module.ClassifierUnavailable):
        classifier.classify(module.EmailInput("Exam", "The exam is tomorrow.", "en"))
