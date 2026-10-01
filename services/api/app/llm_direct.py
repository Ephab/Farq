"""Direct, tool-less structured JSON calls for mechanical extraction work.

Reading a transcript or CV into evidence rows is a single "text in, JSON out" task. Sending it
through the Hermes gateway means a full agent run: ~24k tokens of agent prompt and tool schemas,
a run to create, a 2 s poll loop, and 120 s per rung of a long fallback ladder. This module calls
the model API straight from FastAPI instead (the keys stay server-side, nothing is exposed to the
browser), with short per-attempt timeouts and an immediate hop to the next model.

There are no tools and no Waypoint grant: the document is untrusted text and the model can only
return text. Callers fall back to the gateway only when no direct credentials work.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import httpx

from .hermes import cool_down, is_nvapi_key, is_rate_limited, _cooldown

logger = logging.getLogger("waypoint.llm_direct")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

# Fast first. Measured 2026-10-01 on a small transcript: flash-lite 2-4 s, while the larger Flash
# rungs answered 503 "high demand" and the NIM 550B/30B models were overloaded or hung.
GEMINI_EXTRACT_CHAIN = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.5-flash",
]
NIM_EXTRACT_CHAIN = ["nvidia/nemotron-3-super-120b-a12b"]

GEMINI_ATTEMPT_SECONDS = 30
NIM_ATTEMPT_SECONDS = 50
TOTAL_BUDGET_SECONDS = 75


class DirectUnavailable(RuntimeError):
    """No direct model could answer (no key, or every rung failed); carries the reasons."""

    def __init__(self, message: str, *, configured: bool):
        super().__init__(message)
        self.configured = configured


@dataclass(frozen=True)
class DirectResult:
    text: str
    model: str
    provider: str


def enabled() -> bool:
    return os.getenv("WAYPOINT_DIRECT_EXTRACT", "on").strip().lower() not in {"off", "0", "false", "no"}


def _gemini_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    return key if len(key) >= 16 else ""


def _nim_key(override: str | None) -> str:
    if is_nvapi_key(override):
        return (override or "").strip()
    key = os.getenv("NVIDIA_API_KEY", "").strip()
    return key if len(key) >= 16 else ""


def is_configured(nvidia_override: str | None = None) -> bool:
    return enabled() and bool(_gemini_key() or _nim_key(nvidia_override))


def _ready(models: list[str]) -> list[str]:
    now = time.monotonic()
    return [model for model in models if _cooldown.get(model, 0) <= now]


def _gemini_call(client: httpx.Client, key: str, model: str, instructions: str, prompt: str, max_tokens: int) -> str:
    response = client.post(
        GEMINI_URL.format(model=model),
        headers={"x-goog-api-key": key},
        json={
            "systemInstruction": {"parts": [{"text": instructions}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0, "maxOutputTokens": max_tokens},
        },
    )
    if response.status_code >= 400:
        raise _HttpFailure(response.status_code, response.text)
    payload = response.json()
    candidates = payload.get("candidates") or []
    parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict) and not part.get("thought")).strip()
    if not text:
        raise ValueError("empty answer")
    return text


def _nim_call(client: httpx.Client, key: str, model: str, instructions: str, prompt: str, max_tokens: int) -> str:
    response = client.post(
        NIM_URL,
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": max_tokens,
        },
    )
    if response.status_code >= 400:
        raise _HttpFailure(response.status_code, response.text)
    choices = response.json().get("choices") or []
    text = ((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""
    if not text:
        raise ValueError("empty answer")
    return text


class _HttpFailure(RuntimeError):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:160]}")
        self.status = status
        self.body = body


def run_direct_json(
    instructions: str,
    prompt: str,
    *,
    max_tokens: int = 8192,
    nvidia_override: str | None = None,
    budget_seconds: float = TOTAL_BUDGET_SECONDS,
) -> DirectResult:
    """Ask a fast model for a JSON answer. Raises DirectUnavailable after trying every rung."""
    gemini_key = _gemini_key() if enabled() else ""
    nim_key = _nim_key(nvidia_override) if enabled() else ""
    if not gemini_key and not nim_key:
        raise DirectUnavailable("No direct model key is configured", configured=False)
    rungs: list[tuple[str, str]] = []
    if gemini_key:
        rungs += [(model, "gemini") for model in _ready(GEMINI_EXTRACT_CHAIN)]
    if nim_key:
        rungs += [(model, "nvidia") for model in _ready(NIM_EXTRACT_CHAIN)]
    if not rungs:  # every rung is resting: try the one that recovers first rather than failing outright
        everything = ([(m, "gemini") for m in GEMINI_EXTRACT_CHAIN] if gemini_key else []) + ([(m, "nvidia") for m in NIM_EXTRACT_CHAIN] if nim_key else [])
        rungs = [min(everything, key=lambda item: _cooldown.get(item[0], 0))]
    errors: list[str] = []
    end = time.monotonic() + budget_seconds
    dead_providers: set[str] = set()
    for model, provider in rungs:
        remaining = end - time.monotonic()
        if remaining < 3:
            break
        if provider in dead_providers:
            continue
        attempt = min(GEMINI_ATTEMPT_SECONDS if provider == "gemini" else NIM_ATTEMPT_SECONDS, remaining)
        started = time.monotonic()
        try:
            with httpx.Client(timeout=httpx.Timeout(attempt, connect=5)) as client:
                if provider == "gemini":
                    text = _gemini_call(client, gemini_key, model, instructions, prompt, max_tokens)
                else:
                    text = _nim_call(client, nim_key, model, instructions, prompt, max_tokens)
            logger.info("direct extraction answered by %s in %.1fs", model, time.monotonic() - started)
            return DirectResult(text, model, provider)
        except _HttpFailure as exc:
            errors.append(f"{model}: HTTP {exc.status}")
            if exc.status in (401, 403) and not is_rate_limited(exc.body):
                dead_providers.add(provider)  # a rejected key will not work on a sibling model
            else:
                cool_down(model, f"{exc.status} {exc.body}")
        except httpx.TimeoutException:
            errors.append(f"{model}: no answer within {attempt:.0f}s")
        except (httpx.HTTPError, ValueError) as exc:
            errors.append(f"{model}: {type(exc).__name__}")
        logger.warning("direct extraction rung %s failed after %.1fs: %s", model, time.monotonic() - started, errors[-1])
    raise DirectUnavailable("; ".join(errors[-4:]) or "no model could be tried in time", configured=True)
