from __future__ import annotations

import os
import time
from datetime import datetime, timezone

import httpx

from .database import SessionLocal
from .models import AgentRun, ChatMessage, ChatThread


HERMES_URL = os.getenv("HERMES_URL", "http://127.0.0.1:8642").rstrip("/")
HERMES_API_KEY = os.getenv("HERMES_API_KEY", "")
HERMES_MODEL = os.getenv("HERMES_MODEL", "gemini-3-flash-preview")
HERMES_PROVIDER = os.getenv("HERMES_PROVIDER", "gemini")
NIM_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"

# Keep in sync with src/lib/farq-api.ts HERMES_GEMINI_MODELS / HERMES_NIM_MODELS.
# The env default is always allowed so custom server deployments keep working.
GEMINI_MODELS = frozenset({
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    HERMES_MODEL,
})
NIM_MODELS = frozenset({
    "nvidia/nemotron-3-ultra-550b-a55b",
    "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    "nvidia/nemotron-3.5-lightning-30b-a3b",
})

COACH_INSTRUCTIONS = """
You are Hermes, the Farq student coach. You are a full agent, not a generic chatbot.
Use the Farq tools before making personalized claims. Read the student context and active
roadmap when the request concerns learning direction. Record only facts the student states
explicitly. A choice between branches is an explicit preference and should be recorded.
Never claim that a roadmap changed directly. Submit a future-only proposal with clear
reasoning, then tell the student it is waiting for approval. Completed and in-progress
nodes are protected. When the student's direction is ambiguous, offer two or three concise
branches and ask them to choose before proposing a change.
""".strip()


def resolve_hermes_selection(provider: str | None, model: str | None = None) -> tuple[str, str]:
    """Allowlisted per-run (model, provider slug) for the Farq Hermes gateway.

    Raises ValueError for a model outside the provider's allowlist so the
    request path can reject it with 422 before scheduling background work.
    Never touches gateway config or any system Hermes instance.
    """
    candidate = model.strip() if isinstance(model, str) else None
    if provider == "nim":
        if not candidate:
            return NIM_MODEL, "nvidia"
        if candidate not in NIM_MODELS:
            raise ValueError(f"Unknown NIM model: {candidate}")
        return candidate, "nvidia"
    if provider == "gemini":
        if not candidate:
            return HERMES_MODEL, "gemini"
        if candidate not in GEMINI_MODELS:
            raise ValueError(f"Unknown Gemini model: {candidate}")
        return candidate, "gemini"
    if candidate:
        if candidate in NIM_MODELS:
            return candidate, "nvidia"
        if candidate in GEMINI_MODELS:
            return candidate, "gemini"
        raise ValueError(f"Unknown Hermes model: {candidate}")
    return HERMES_MODEL, HERMES_PROVIDER


def effective_hermes_key(override: str | None) -> str:
    """Tab-only override wins when long enough; otherwise the server env.

    The override is held in memory for one request only — never persisted,
    never written to .env, never sent to a system Hermes.
    """
    if isinstance(override, str) and len(override.strip()) >= 16:
        return override.strip()
    return HERMES_API_KEY


def raise_for_gateway_status(response: httpx.Response) -> None:
    """Raise for a gateway response, translating 401 into an actionable error.

    The gateway rejects the run when the Bearer key does not match its
    API_SERVER_KEY: either a stale tab-only Settings override is being sent,
    or the API and gateway were started with different keys.
    """
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise RuntimeError(
                "Hermes gateway rejected the API key (401). Press Apply in Settings "
                "to save this tab's key to the server, or clear the tab-only key so "
                "the server key is used; otherwise restart the Farq stack so the API "
                "and gateway share the same key."
            ) from exc
        raise


def run_agent(
    local_run_id: str,
    student_id: str,
    provider: str | None = None,
    model: str | None = None,
    hermes_api_key: str | None = None,
) -> None:
    db = SessionLocal()
    run = db.get(AgentRun, local_run_id)
    if run is None:
        db.close()
        return
    thread = db.get(ChatThread, run.thread_id)
    message = db.get(ChatMessage, run.user_message_id)
    try:
        gateway_key = effective_hermes_key(hermes_api_key)
        if len(gateway_key) < 16:
            raise RuntimeError("Farq Hermes key is missing or too short; set it in Settings (this tab) or run scripts/setup.ps1")
        try:
            hermes_model, hermes_provider = resolve_hermes_selection(provider, model)
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc
        run.status = "running"
        run.stage = "Starting Hermes"
        db.commit()
        headers = {
            "Authorization": f"Bearer {gateway_key}",
            "Idempotency-Key": local_run_id,
            "X-Hermes-Session-Key": f"farq:user:{student_id}:{thread.hermes_session_id}",
        }
        payload = {
            "input": (
                f"Farq user_id={student_id}; source_message_id={message.id}.\n\n"
                f"Student message:\n{message.content}"
            ),
            "session_id": thread.hermes_session_id,
            "instructions": COACH_INSTRUCTIONS,
            "model": hermes_model,
            "provider": hermes_provider,
        }
        with httpx.Client(timeout=20) as client:
            response = client.post(f"{HERMES_URL}/v1/runs", headers=headers, json=payload)
            raise_for_gateway_status(response)
            result = response.json()
            run.hermes_run_id = result["run_id"]
            run.stage = "Hermes is reviewing your context"
            db.commit()

            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                poll = client.get(f"{HERMES_URL}/v1/runs/{run.hermes_run_id}", headers=headers)
                raise_for_gateway_status(poll)
                state = poll.json()
                status = state.get("status")
                run.stage = {
                    "started": "Hermes is thinking",
                    "running": "Hermes is using Farq tools",
                    "waiting_for_approval": "Hermes needs approval",
                }.get(status, "Hermes is working")
                db.commit()
                if status == "completed":
                    output = state.get("output") or "I finished, but did not return a message."
                    assistant = ChatMessage(
                        thread_id=thread.id,
                        role="assistant",
                        content=output,
                        agent_run_id=run.id,
                    )
                    db.add(assistant)
                    run.status = "completed"
                    run.stage = "Complete"
                    run.finished_at = datetime.now(timezone.utc)
                    db.commit()
                    return
                if status in {"failed", "cancelled"}:
                    raise RuntimeError(state.get("error") or f"Hermes run {status}")
                time.sleep(1)
            raise TimeoutError("Hermes did not finish within 180 seconds")
    except Exception as exc:  # preserve the real failure; there is intentionally no fake fallback
        run.status = "failed"
        run.stage = "Hermes unavailable"
        run.error = str(exc)
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()
