"""Settings > Models: measure how fast each model of a provider answers right now.

Hosted endpoints queue models very differently from hour to hour (on 2026-10-02 NVIDIA's free tier took
15 s to start answering "Hi" on Nemotron Lightning, the smallest model, and 0.5 s on Ultra, the largest),
so a static "fastest" label misleads. This sends one tiny streamed prompt to every model of the provider
in parallel, with the server's own key, and reports time to first token and decode speed. Nothing
about the student is sent.
"""
from __future__ import annotations

import os
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from .connections import require_local
from .hermes import PROVIDERS

router = APIRouter()

# OpenAI-compatible chat endpoints for each provider (Gemini exposes one too).
CHAT_URLS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "nim": "https://integrate.api.nvidia.com/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "hf": "https://router.huggingface.co/v1/chat/completions",
}
PROBE = "Reply with one short sentence about why practice matters when learning to code."
PROBE_TIMEOUT = 30.0


class SpeedInput(BaseModel):
    provider: str


def probe(provider: str, model: str, key: str) -> dict:
    """Time to first token and rough tokens/s for one tiny streamed answer."""
    start = time.monotonic()
    first: float | None = None
    chars = 0
    try:
        with httpx.stream(
            "POST", CHAT_URLS[provider], headers={"Authorization": f"Bearer {key}"}, timeout=PROBE_TIMEOUT,
            json={"model": model, "messages": [{"role": "user", "content": PROBE}], "stream": True, "max_tokens": 60},
        ) as response:
            if response.status_code != 200:
                return {"model": model, "error": f"HTTP {response.status_code}", "seconds": round(time.monotonic() - start, 1)}
            for line in response.iter_lines():
                if not line.startswith("data:") or line.strip() == "data: [DONE]":
                    continue
                text = _delta_text(line[5:])
                if text:
                    first = first if first is not None else time.monotonic() - start
                    chars += len(text)
                if time.monotonic() - start > PROBE_TIMEOUT:
                    break
    except httpx.TimeoutException:
        return {"model": model, "error": "timeout", "seconds": round(time.monotonic() - start, 1)}
    except httpx.HTTPError as exc:
        return {"model": model, "error": type(exc).__name__, "seconds": round(time.monotonic() - start, 1)}
    total = time.monotonic() - start
    if first is None:
        return {"model": model, "error": "no answer", "seconds": round(total, 1)}
    writing = max(total - first, 0.05)
    return {"model": model, "first_token": round(first, 1), "seconds": round(total, 1), "tps": round(chars / 4 / writing, 1)}


def _delta_text(payload: str) -> str:
    import json

    try:
        choice = (json.loads(payload).get("choices") or [{}])[0]
    except (ValueError, AttributeError):
        return ""
    delta = choice.get("delta") or {}
    return str(delta.get("content") or delta.get("reasoning_content") or "")


@router.post("/api/settings/models/speed")
def model_speed(body: SpeedInput, request: Request) -> dict:
    require_local(request)
    option = PROVIDERS.get(body.provider)
    if option is None:
        raise HTTPException(422, "Unknown provider")
    key = os.getenv(option.key_env, "").strip()
    if not key:
        raise HTTPException(409, f"{option.key_env} is not set")
    models = [item.id for item in option.models]
    with ThreadPoolExecutor(max_workers=len(models)) as pool:
        results = list(pool.map(lambda model: probe(body.provider, model, key), models))
    return {"provider": body.provider, "results": results, "checked_at": time.time()}
