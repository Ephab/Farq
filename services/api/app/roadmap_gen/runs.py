"""Background first-roadmap generation runs, one per student.

A run is an append-only event log (plan, stage, done, error) plus a condition other coroutines wait on.
It lives in the server process, not in the HTTP request that started it, so the student can close the
generation page, browse the app, or reload while Hermes keeps working; a stream or status poll attaches
to the log at any time and replays what has already happened. Runs never survive a restart: startup
puts any student left in `generating` back to `chat`.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

TERMINAL = {"done", "error", "cancelled"}


class GenerationRun:
    def __init__(self, student_id: str) -> None:
        self.student_id = student_id
        self.events: list[tuple[str, dict[str, Any]]] = []
        self.finished = False
        self.task: asyncio.Task | None = None
        self._cond = asyncio.Condition()

    async def publish(self, name: str, payload: dict[str, Any]) -> None:
        async with self._cond:
            if self.finished:
                return
            self.events.append((name, payload))
            if name in TERMINAL:
                self.finished = True
            self._cond.notify_all()

    async def follow(self) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """Replay every event so far, then each new one, until the run is over."""
        seen = 0
        while True:
            async with self._cond:
                await self._cond.wait_for(lambda: len(self.events) > seen or self.finished)
                batch = self.events[seen:]
                seen = len(self.events)
                over = self.finished
            for item in batch:
                yield item
            if over:
                return

    def summary(self) -> dict[str, Any]:
        plan: dict | None = None
        completed: list[str] = []
        state = "running"
        proposal_id: str | None = None
        error: str | None = None
        for name, payload in self.events:
            if name == "plan":
                plan = payload.get("plan")
            elif name == "stage":
                completed.append(payload.get("stage_id", ""))
            elif name == "done":
                state, proposal_id = "done", payload.get("proposal_id")
            elif name == "error":
                state, error = "error", payload.get("error")
            elif name == "cancelled":
                state = "cancelled"
        stages = (plan or {}).get("stages") or []
        return {
            "state": state,
            "title": (plan or {}).get("title"),
            "total_stages": len(stages),
            "completed_stage_ids": completed,
            "proposal_id": proposal_id,
            "error": error,
        }


_runs: dict[str, GenerationRun] = {}


def get(student_id: str) -> GenerationRun | None:
    return _runs.get(student_id)


def live(student_id: str) -> GenerationRun | None:
    run = _runs.get(student_id)
    return run if run is not None and not run.finished else None


def register(run: GenerationRun) -> None:
    _runs[run.student_id] = run
