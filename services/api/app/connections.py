"""Settings > Models & connections: which provider keys exist, where they come from, live checks.

Key values never leave this module: responses carry only `set`, `source` and a masked hint (last 4
characters, and only to a local caller). Writes go to the repo-root .env and are loopback-only, with the
same Origin/Host checks as the Hermes settings apply and the Outlook consent. The engine switch lives
in the `app_settings` table so flipping it never restarts anything.
"""
from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from . import decision_engines
from .hermes import HERMES_MODEL, HERMES_PROVIDER, HERMES_URL, resolve_hermes_selection
from .settings_env import ENV_PATH, read_env_values, write_env_values
from .transcribe import TRANSCRIBE_MODEL

router = APIRouter()
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
TEST_TIMEOUT = 8.0


def require_local(request: Request) -> None:
    """Writing the server's .env, or spending a key on a test call, is for the person at this computer."""
    host = request.client.host if request.client else ""
    origin = request.headers.get("origin")
    if host not in LOOPBACK_HOSTS or (request.url.hostname or "") not in LOOPBACK_HOSTS:
        raise HTTPException(403, "Settings can only be changed from this computer")
    if origin and (urlparse(origin).hostname or "") not in LOOPBACK_HOSTS:
        raise HTTPException(403, "Settings can only be changed from this computer")


def is_local(request: Request) -> bool:
    try:
        require_local(request)
        return True
    except HTTPException:
        return False


@dataclass(frozen=True)
class Connection:
    id: str
    env: str
    settable: bool
    live: bool  # True: the API reads the key per call, so a save applies at once; False: the Hermes gateway reads it
    url: str
    test: Callable[[str], None] | None


class TestFailure(Exception):
    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(code)
        self.code, self.detail = code, detail


def _get(url: str, headers: dict[str, str]) -> None:
    response = httpx.get(url, headers=headers, timeout=TEST_TIMEOUT, follow_redirects=False)
    _check(response)


def _check(response: httpx.Response) -> None:
    status = response.status_code
    if status in (401, 403):
        raise TestFailure("rejected")
    if status == 429:
        raise TestFailure("rate_limited")
    if status >= 400:
        raise TestFailure("http_error", str(status))


def _test_gemini(key: str) -> None:
    _get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {"x-goog-api-key": key})


def _test_nvidia(key: str) -> None:
    _get("https://integrate.api.nvidia.com/v1/models", {"Authorization": f"Bearer {key}"})


def _test_hf(key: str) -> None:
    _get("https://huggingface.co/api/whoami-v2", {"Authorization": f"Bearer {key}"})


def _test_openrouter(key: str) -> None:
    _get("https://openrouter.ai/api/v1/auth/key", {"Authorization": f"Bearer {key}"})


def _test_apify(key: str) -> None:
    _get("https://api.apify.com/v2/users/me", {"Authorization": f"Bearer {key}"})


def _test_jev(key: str) -> None:
    response = httpx.post(decision_engines.JEV_URL, headers={"Authorization": f"Bearer {key}"}, timeout=TEST_TIMEOUT, json={
        "state": "Connection check", "model": decision_engines.jev_info().model,
        "questions": {"ping": {"type": "noul", "instructions": "This is a connection check"}}})
    _check(response)


def _test_hermes(key: str) -> None:
    _get(f"{HERMES_URL}/health/detailed", {"Authorization": f"Bearer {key}"})


CONNECTIONS: tuple[Connection, ...] = (
    Connection("gemini", "GEMINI_API_KEY", True, False, "https://aistudio.google.com/apikey", _test_gemini),
    Connection("nvidia", "NVIDIA_API_KEY", True, False, "https://build.nvidia.com/settings/api-keys", _test_nvidia),
    Connection("huggingface", "HF_TOKEN", True, False, "https://huggingface.co/settings/tokens", _test_hf),
    Connection("jev", "TYPESAFE_AI_API_KEY", True, True, "https://typesafe.ai", _test_jev),
    Connection("span", "OPENROUTER_API_KEY", True, True, "https://openrouter.ai/settings/keys", _test_openrouter),
    Connection("apify", "APIFY_API_KEY", True, True, "https://console.apify.com/settings/integrations", _test_apify),
    Connection("gateway", "HERMES_API_KEY", False, False, "", _test_hermes),
)
BY_ID = {item.id: item for item in CONNECTIONS}


def _env_file() -> dict[str, str]:
    return read_env_values(ENV_PATH)


def effective(env: str, file_values: dict[str, str] | None = None) -> tuple[str, str]:
    """(value, source). The runners start children with .env values over the process environment."""
    values = _env_file() if file_values is None else file_values
    if values.get(env, "").strip():
        return values[env].strip(), "env_file"
    process = os.environ.get(env, "").strip()
    return (process, "environment") if process else ("", "none")


def _hint(value: str) -> str | None:
    return f"…{value[-4:]}" if len(value) >= 12 else None


# Browser provider ids -> (server provider slug, the connection that holds that provider's key).
HERMES_PROVIDERS = {"gemini": ("gemini", "gemini"), "nim": ("nvidia", "nvidia"), "hf": ("huggingface", "huggingface"), "openrouter": ("openrouter", "span")}
_UI_PROVIDER = {slug: ui for ui, (slug, _c) in HERMES_PROVIDERS.items()}


def _hermes_choice(file_values: dict[str, str]) -> dict:
    """The server-default provider/model: .env if present, else what this process started with."""
    slug = file_values.get("HERMES_PROVIDER", "").strip() or HERMES_PROVIDER
    model = file_values.get("HERMES_MODEL", "").strip() or HERMES_MODEL
    provider = _UI_PROVIDER.get(slug, "gemini")
    return {"provider": provider, "model": model, "key_connection": HERMES_PROVIDERS[provider][1],
            "key_env": BY_ID[HERMES_PROVIDERS[provider][1]].env}


def _models() -> list[dict]:
    jev, span, laya = decision_engines.jev_info(), decision_engines.span_info(), decision_engines.laya_info()
    choice = decision_engines.engine_choice()
    lead = next((e for e in (jev, span, laya) if e.available and e.id in decision_engines.active_chain()), None)
    return [
        {"feature": "coach", "provider": HERMES_PROVIDER, "model": HERMES_MODEL},
        {"feature": "extraction", "provider": HERMES_PROVIDER, "model": HERMES_MODEL},
        {"feature": "dictation", "provider": "gemini", "model": TRANSCRIBE_MODEL},
        {"feature": "decisions", "provider": lead.provider if lead else None, "model": lead.model if lead else None,
         "engine": lead.id if lead else None, "choice": choice},
    ]


def build_status(local: bool) -> dict:
    file_values = _env_file()
    connections = []
    for item in CONNECTIONS:
        value, source = effective(item.env, file_values)
        connections.append({
            "id": item.id, "env": item.env, "set": bool(value), "source": source,
            "hint": _hint(value) if local and value else None,
            "settable": item.settable and local, "apply": "live" if item.live else "restart",
            "url": item.url, "testable": item.test is not None,
        })
    laya = decision_engines.laya_info()
    return {
        "can_edit": local,
        "env_file": {"name": ENV_PATH.name, "exists": ENV_PATH.exists()},
        "connections": connections,
        "local_model": {"id": "laya", "available": laya.available, "reason": laya.reason, "loaded": decision_engines.laya_loaded(), "model": laya.model},
        "models": _models(),
        "hermes": _hermes_choice(file_values),
        "decision_engine": {
            "choice": decision_engines.engine_choice(), "choices": list(decision_engines.ENGINE_MODES),
            "engines": decision_engines.engines_status(),
        },
    }


@router.get("/api/settings/connections")
def connections_status(request: Request) -> dict:
    return build_status(is_local(request))


class KeyUpdate(BaseModel):
    value: str


_SAFE = re.compile(r"^[\x21-\x7e]{8,512}$")  # printable ASCII, no spaces/newlines: cannot inject extra .env lines


@router.put("/api/settings/connections/{connection_id}")
def set_key(connection_id: str, body: KeyUpdate, request: Request) -> dict:
    require_local(request)
    item = BY_ID.get(connection_id)
    if item is None or not item.settable:
        raise HTTPException(404, "Unknown or read-only connection")
    value = body.value.strip()
    if value and not _SAFE.match(value):
        raise HTTPException(422, "That does not look like an API key (8+ visible characters, no spaces)")
    try:
        write_env_values({item.env: value}, ENV_PATH)
    except FileNotFoundError as exc:
        raise HTTPException(409, f"No .env file on this server; set {item.env} in the server environment instead") from exc
    except OSError as exc:
        raise HTTPException(500, "Could not write the .env file") from exc
    if value:
        os.environ[item.env] = value
    else:
        os.environ.pop(item.env, None)
    return {"status": "saved", "apply": "live" if item.live else "restart", "connection": next(c for c in build_status(True)["connections"] if c["id"] == item.id)}


@router.post("/api/settings/connections/{connection_id}/test")
def test_connection(connection_id: str, request: Request) -> dict:
    require_local(request)
    item = BY_ID.get(connection_id)
    if item is None or item.test is None:
        raise HTTPException(404, "Unknown connection")
    value, _source = effective(item.env)
    if not value:
        return {"ok": False, "code": "not_set", "detail": "", "latency_ms": None}
    started = time.perf_counter()
    try:
        item.test(value)
        code, detail = "ok", ""
    except TestFailure as failure:
        code, detail = failure.code, failure.detail
    except httpx.TimeoutException:
        code, detail = "timeout", ""
    except httpx.HTTPError:
        code, detail = "network", ""
    return {"ok": code == "ok", "code": code, "detail": detail, "latency_ms": round((time.perf_counter() - started) * 1000)}


class EngineUpdate(BaseModel):
    engine: str


@router.put("/api/settings/decision-engine")
def set_decision_engine(body: EngineUpdate, request: Request) -> dict:
    require_local(request)
    try:
        decision_engines.set_engine_choice(body.engine)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return build_status(True)


class HermesModelUpdate(BaseModel):
    provider: str
    model: str | None = None


@router.put("/api/settings/hermes-model")
def set_hermes_model(body: HermesModelUpdate, request: Request) -> dict:
    """Server-default Coach/extraction model. Never touches HERMES_API_KEY: a provider's key has its own env name."""
    require_local(request)
    if body.provider not in HERMES_PROVIDERS:
        raise HTTPException(422, "Unknown provider")
    try:
        model, slug = resolve_hermes_selection(body.provider, body.model)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    try:
        write_env_values({"HERMES_MODEL": model, "HERMES_PROVIDER": slug}, ENV_PATH)
    except FileNotFoundError as exc:
        raise HTTPException(409, "No .env file on this server; set HERMES_MODEL and HERMES_PROVIDER in the server environment instead") from exc
    except OSError as exc:
        raise HTTPException(500, "Could not write the .env file") from exc
    return {"status": "saved", "restart_required": True, "hermes": _hermes_choice(_env_file())}
