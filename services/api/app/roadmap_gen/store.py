from __future__ import annotations

"""In-memory staged-generation jobs.

A job holds the plan plus one node batch per completed stage. Stage
generation itself is stateless (brief + plan + prior summaries -> nodes);
only the append is serialized under a lock, so concurrent stage calls
cannot corrupt each other. Jobs are short-lived: created by plan,
consumed by finalize, and never survive a restart (regeneration is cheap).
"""

import threading
import uuid

from ..schemas import RoadmapNode, RoadmapPlan

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def create_job(student_id: str, base_version_id: str, brief: dict, plan: RoadmapPlan, hermes: dict) -> str:
    job_id = str(uuid.uuid4())
    confirmed = {row["evidence_id"] for rows in brief.get("confirmed_evidence", {}).values() for row in rows}
    with _lock:
        _jobs[job_id] = {
            "student_id": student_id,
            "base_version_id": base_version_id,
            "brief": brief,
            "plan": plan,
            "hermes": hermes,
            "confirmed": confirmed,
            "completed": {},  # stage_id -> list[RoadmapNode]
        }
    return job_id


def get_job(job_id: str) -> dict | None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        return {**job, "completed": dict(job["completed"])}


def append_stage(job_id: str, stage_id: str, nodes: list[RoadmapNode]) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if stage_id in job["completed"]:
            raise ValueError(f"Stage {stage_id} was already generated for this job")
        job["completed"][stage_id] = nodes


def drop_job(job_id: str) -> None:
    with _lock:
        _jobs.pop(job_id, None)


def prior_node_summaries(job: dict, upto_stage_id: str) -> tuple[list[dict], list[str]]:
    """Node summaries + used IDs for every stage planned before `upto_stage_id`."""
    prior: list[dict] = []
    used: list[str] = []
    for item in job["plan"].stages:
        if item.id == upto_stage_id:
            break
        for node in job["completed"].get(item.id, []):
            prior.append({"id": node.id, "title": node.title})
            used.append(node.id)
    return prior, used
