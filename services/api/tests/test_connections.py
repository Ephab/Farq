import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import app_settings, connections, database, decision_engines
from app.models import AppSetting

KEY = "sk-test-abcdefghijklmnop1234"
ENV_KEYS = ["GEMINI_API_KEY", "NVIDIA_API_KEY", "HF_TOKEN", "TYPESAFE_AI_API_KEY", "OPENROUTER_API_KEY", "APIFY_API_KEY", "HERMES_API_KEY"]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("# comment\nGEMINI_API_KEY=" + KEY + "\nNVIDIA_API_KEY=\nOTHER=keep\n", encoding="utf-8")
    monkeypatch.setattr(connections, "ENV_PATH", path)
    for name in ENV_KEYS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HF_TOKEN", "hf_process_env_value_1234")
    # Engine switch persists to its own throwaway database.
    test_engine = create_engine(f"sqlite:///{(tmp_path / 'db.sqlite').as_posix()}")
    AppSetting.metadata.create_all(test_engine, tables=[AppSetting.__table__])
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=test_engine, expire_on_commit=False))
    monkeypatch.setattr(app_settings, "_cache", {})
    return path


@pytest.fixture()
def client(env):
    app = FastAPI()
    app.include_router(connections.router)
    return TestClient(app, base_url="http://localhost")


def by_id(payload):
    return {item["id"]: item for item in payload["connections"]}


def test_status_reports_source_and_masks_values(client):
    payload = client.get("/api/settings/connections").json()
    items = by_id(payload)
    assert items["gemini"]["set"] and items["gemini"]["source"] == "env_file" and items["gemini"]["hint"] == "…" + KEY[-4:]
    assert items["huggingface"]["source"] == "environment"
    assert items["nvidia"]["set"] is False and items["nvidia"]["source"] == "none"  # empty .env value is not "set"
    assert KEY not in client.get("/api/settings/connections").text
    assert items["gateway"]["settable"] is False
    assert {m["feature"] for m in payload["models"]} == {"coach", "extraction", "dictation", "decisions"}


def test_remote_caller_cannot_see_hints_or_write(client):
    remote = TestClient(client.app, base_url="http://localhost", client=("203.0.113.9", 5000))
    items = by_id(remote.get("/api/settings/connections").json())
    assert items["gemini"]["hint"] is None and items["gemini"]["settable"] is False
    assert remote.put("/api/settings/connections/gemini", json={"value": KEY}).status_code == 403
    assert remote.post("/api/settings/connections/gemini/test").status_code == 403
    assert remote.put("/api/settings/decision-engine", json={"engine": "jev"}).status_code == 403


def test_cross_site_origin_is_refused(client):
    headers = {"Origin": "https://evil.example"}
    assert client.put("/api/settings/connections/gemini", json={"value": KEY}, headers=headers).status_code == 403
    assert client.put("/api/settings/decision-engine", json={"engine": "jev"}, headers=headers).status_code == 403
    assert client.put("/api/settings/connections/gemini", json={"value": KEY}, headers={"Origin": "http://localhost:5173"}).status_code == 200


def test_save_key_writes_env_and_applies_live(client, env, monkeypatch):
    new = "or-new-key-0123456789abcdef"
    response = client.put("/api/settings/connections/span", json={"value": new})
    assert response.status_code == 200 and response.json()["apply"] == "live"
    assert new not in response.text
    text = env.read_text()
    assert f"OPENROUTER_API_KEY={new}" in text and "OTHER=keep" in text and "# comment" in text
    import os
    assert os.environ["OPENROUTER_API_KEY"] == new
    assert client.put("/api/settings/connections/gemini", json={"value": KEY}).json()["apply"] == "restart"
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)


def test_save_key_rejects_bad_values_and_readonly(client, env):
    assert client.put("/api/settings/connections/span", json={"value": "short"}).status_code == 422
    assert client.put("/api/settings/connections/span", json={"value": "abcdefgh\nINJECT=1"}).status_code == 422
    assert client.put("/api/settings/connections/gateway", json={"value": KEY}).status_code == 404
    assert "INJECT" not in env.read_text()


def test_save_without_env_file_is_a_clear_conflict(client, env):
    env.unlink()
    assert client.put("/api/settings/connections/span", json={"value": KEY}).status_code == 409


def test_connection_test_maps_failures(client, monkeypatch):
    calls = []
    def fake_get(url, headers=None, timeout=None, follow_redirects=None):
        calls.append((url, headers))
        return httpx.Response(401, request=httpx.Request("GET", url))
    monkeypatch.setattr(connections.httpx, "get", fake_get)
    result = client.post("/api/settings/connections/gemini/test").json()
    assert result["ok"] is False and result["code"] == "rejected"
    assert calls[0][1]["x-goog-api-key"] == KEY and KEY not in str(result)
    assert client.post("/api/settings/connections/nvidia/test").json()["code"] == "not_set"
    monkeypatch.setattr(connections.httpx, "get", lambda *a, **k: httpx.Response(200, request=httpx.Request("GET", a[0])))
    assert client.post("/api/settings/connections/gemini/test").json()["ok"] is True

    def boom(*a, **k):
        raise httpx.ConnectTimeout("slow")
    monkeypatch.setattr(connections.httpx, "get", boom)
    assert client.post("/api/settings/connections/gemini/test").json()["code"] == "timeout"


def test_engine_switch_persists_and_narrows_the_chain(client, monkeypatch):
    assert client.get("/api/settings/connections").json()["decision_engine"]["choice"] == "auto"
    assert client.put("/api/settings/decision-engine", json={"engine": "bogus"}).status_code == 422
    payload = client.put("/api/settings/decision-engine", json={"engine": "jev"}).json()
    assert payload["decision_engine"]["choice"] == "jev"
    selected = {e["id"]: e["selected"] for e in payload["decision_engine"]["engines"]}
    assert selected == {"jev": True, "span": True, "laya": False}
    app_settings.forget_cached_settings()  # a fresh process reads the persisted value
    assert decision_engines.engine_choice() == "jev"


def test_jev_mode_never_touches_laya(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", KEY)
    monkeypatch.setenv("JEV_ENABLED", "true")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    laya_calls = []
    monkeypatch.setitem(decision_engines.ASK, "laya", lambda *a: laya_calls.append(a))
    monkeypatch.setattr(decision_engines, "shared_laya", lambda: laya_calls.append("loaded"))
    client.put("/api/settings/decision-engine", json={"engine": "jev"})

    def fail(*a, **k):
        raise httpx.ConnectTimeout("slow")
    monkeypatch.setattr(decision_engines.httpx, "post", fail)
    with pytest.raises(decision_engines.EngineUnavailable):
        decision_engines.ask_chain("s", {"q": {"type": "noul", "instructions": "x"}})
    from app.email_classifier import ClassifierUnavailable, EmailInput

    class Boom:
        def classify(self, email):
            laya_calls.append("classify")
    with pytest.raises(ClassifierUnavailable):
        decision_engines.classify_email(EmailInput("Subject", "Body"), "laya", Boom())
    assert laya_calls == []


def test_laya_mode_skips_cloud(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", KEY)
    monkeypatch.setenv("JEV_ENABLED", "true")
    client.put("/api/settings/decision-engine", json={"engine": "laya"})
    monkeypatch.setattr(decision_engines.httpx, "post", lambda *a, **k: pytest.fail("cloud called"))
    monkeypatch.setitem(decision_engines.INFO, "laya", lambda: decision_engines.EngineInfo("laya", "Laya", "local", "local", "m", True, ""))
    monkeypatch.setitem(decision_engines.ASK, "laya", lambda s, q, t: {"model": "m", "answers": {}})
    assert decision_engines.ask_chain("s", {}).engine == "laya"


def test_hermes_model_is_saved_live_and_never_touches_env(client, env):
    from app.hermes import resolve_hermes_selection

    env.write_text(env.read_text() + "HERMES_API_KEY=" + "g" * 40 + "\n")
    before = env.read_text()
    status = client.get("/api/settings/connections").json()["hermes"]
    assert set(status) == {"provider", "model", "key_connection", "key_env"}
    response = client.put("/api/settings/hermes-model", json={"provider": "nim", "model": "nvidia/nemotron-3-super-120b-a12b"})
    assert response.status_code == 200 and response.json()["apply"] == "live"
    assert response.json()["hermes"] == {"provider": "nim", "model": "nvidia/nemotron-3-super-120b-a12b",
                                         "key_connection": "nvidia", "key_env": "NVIDIA_API_KEY"}
    # The next run without its own choice uses it at once; .env (and so the runner's restart watch) is untouched.
    assert resolve_hermes_selection(None, None) == ("nvidia/nemotron-3-super-120b-a12b", "nvidia")
    assert env.read_text() == before
    catalog = client.get("/api/settings/models").json()
    assert catalog["selected"]["model"] == "nvidia/nemotron-3-super-120b-a12b"
    nim = next(p for p in catalog["providers"] if p["id"] == "nim")
    assert nim["key_env"] == "NVIDIA_API_KEY" and nim["models"][0]["note"]
    assert client.put("/api/settings/hermes-model", json={"provider": "gemini", "model": "nope"}).status_code == 422
    assert client.put("/api/settings/hermes-model", json={"provider": "other"}).status_code == 422
    assert client.put("/api/settings/hermes-model", json={"provider": "hf"}, headers={"Origin": "https://evil.example"}).status_code == 403
    client.put("/api/settings/hermes-model", json={"provider": "gemini"})
    assert resolve_hermes_selection(None, None) == ("gemini-3.8-flash", "gemini")


def test_runner_restarts_only_processes_that_read_the_changed_keys():
    from scripts.runtime import restart_targets
    assert restart_targets({"A": "1"}, {"A": "1"}) == ()
    assert restart_targets({}, {"APIFY_API_KEY": "x"}) == ("api",)
    assert restart_targets({}, {"TYPESAFE_AI_API_KEY": "x"}) == ("api",)
    assert restart_targets({"GEMINI_API_KEY": "a"}, {"GEMINI_API_KEY": "b"}) == ("api", "hermes")
    assert restart_targets({}, {"HERMES_MODEL": "m"}) == ("api", "hermes")
