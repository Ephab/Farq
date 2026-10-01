"""Process-local progress for source reads (queued / reading / extracting / saving).

Only transient progress lives here; the authoritative result is still `DataSource.status` and the
`EvidenceItem` rows. A source that SQLite says is `syncing` but that has no live job here was
interrupted by a restart and is reported as failed so the student can retry.
"""

from __future__ import annotations

import threading
import time
from typing import Any

_lock = threading.Lock()
_active: dict[str, dict[str, Any]] = {}
_notes: dict[str, str] = {}

STAGES = ("queued", "reading", "extracting", "saving")


def begin(source_id: str, stage: str = "queued") -> None:
    with _lock:
        _active[source_id] = {"stage": stage, "detail": {}, "started_at": time.time()}
        _notes.pop(source_id, None)


def set_stage(source_id: str, stage: str, **detail: Any) -> None:
    """Record a stage. `warning` is kept after the job ends so a partial read stays visible."""
    with _lock:
        if stage == "warning":
            _notes[source_id] = str(detail.get("message", ""))[:300]
            return
        job = _active.get(source_id)
        if job is not None:
            job["stage"] = stage
            job["detail"] = detail


def finish(source_id: str) -> None:
    with _lock:
        _active.pop(source_id, None)


def is_active(source_id: str) -> bool:
    with _lock:
        return source_id in _active


def snapshot(source_id: str) -> dict[str, Any]:
    """Progress fields merged into the API's source dict (empty when nothing is running)."""
    with _lock:
        job = _active.get(source_id)
        note = _notes.get(source_id)
        out: dict[str, Any] = {}
        if job is not None:
            out["stage"] = job["stage"]
            out["progress"] = dict(job["detail"])
            out["elapsed_seconds"] = round(time.time() - job["started_at"], 1)
        if note:
            out["note"] = note
        return out


def reset() -> None:
    with _lock:
        _active.clear()
        _notes.clear()
