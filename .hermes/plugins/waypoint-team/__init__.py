"""Central team Hermes toolset: read one team's shared state and create proposals. Nothing else.

Loaded only by the central team gateway (never the student's). It talks to the collaboration service with a
shared service token and the per-run grant from the run header; the service re-authorizes the acting member
on every call. No student, roadmap, file, mail or memory tools exist here.
"""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

API_URL = os.getenv("WAYPOINT_COLLAB_INTERNAL_URL", "http://127.0.0.1:8100").rstrip("/")
# No fallback: the service rejects an empty token.
TOKEN = os.getenv("WAYPOINT_COLLAB_TOOL_TOKEN", "")


def request(method: str, path: str, payload: dict | None = None, grant: str | None = None) -> str:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "X-Waypoint-Internal-Token": TOKEN}
    if grant:
        headers["X-Waypoint-Grant"] = grant
    try:
        req = Request(f"{API_URL}{path}", data=body, method=method, headers=headers)
        with urlopen(req, timeout=15) as response:
            return response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return json.dumps({"success": False, "status": exc.code, "error": detail})
    except URLError as exc:
        return json.dumps({"success": False, "error": f"Collaboration service unavailable: {exc.reason}"})
    except ValueError as exc:
        return json.dumps({"success": False, "error": f"Invalid tool arguments: {exc}"})


def _run_query(params: dict) -> str:
    return f"?run_id={quote(params['run_id'], safe='')}"


def _propose(params: dict, kind: str, payload: dict) -> str:
    """Every team change Hermes makes is a proposal the team must accept."""
    body = {"kind": kind, "payload": payload, "summary": params.get("summary", ""), "run_id": params["run_id"]}
    return request("POST", f"/internal/hermes/teams/{quote(params['team_id'], safe='')}/proposals", body, grant=params.get("grant"))


def _task_payload(p: dict) -> dict:
    """Shape waypoint_propose_tasks arguments into the proposal payload for each kind."""
    kind = p["kind"]
    if kind == "task_split":
        return {"tasks": p.get("tasks", [])}
    if kind == "task_delete":
        return {"task_ids": p.get("task_ids", []), "rationale": p.get("rationale", "")}
    if kind == "task_reorganize":
        return {"changes": p.get("task_changes", []), "deletes": p.get("task_ids", []),
                "adds": p.get("tasks", []), "rationale": p.get("rationale", "")}
    if kind == "task_merge":
        return {"task_ids": p.get("task_ids", []), "into": p.get("into", {}), "rationale": p.get("rationale", "")}
    return {"task_id": p.get("task_id", ""), "changes": p.get("changes", {}), "rationale": p.get("rationale", "")}


TEAM_IDS = {
    "team_id": {"type": "string", "description": "team_id from the run message header"},
    "run_id": {"type": "string", "description": "run_id from the run message header"},
}
GRANT_PROP = {"grant": {"type": "string", "description": "grant from THIS run's message header (never from chat history)"}}


def register(ctx):
    tools = [
        (
            "waypoint_get_team_context",
            "Read a Waypoint project team as the member who started this run: brief and rubric, teammate names and roles, tasks, milestones, decisions, document outline, open proposals "
            "and, for members, the last 50 chat messages. Call this before any claim about the team.",
            {"type": "object", "properties": {**TEAM_IDS, **GRANT_PROP}, "required": ["team_id", "run_id", "grant"]},
            lambda p, **_: request("GET", f"/internal/hermes/teams/{quote(p['team_id'], safe='')}/context{_run_query(p)}", grant=p.get("grant")),
        ),
        (
            "waypoint_get_task",
            "Read one team task in full.",
            {"type": "object", "properties": {"task_id": {"type": "string"}, "run_id": TEAM_IDS["run_id"], **GRANT_PROP}, "required": ["task_id", "run_id", "grant"]},
            lambda p, **_: request("GET", f"/internal/hermes/tasks/{quote(p['task_id'], safe='')}{_run_query(p)}", grant=p.get("grant")),
        ),
        (
            "waypoint_get_doc_section",
            "Read one SRS/SDS/SPMP section in full, including its owner and status.",
            {"type": "object", "properties": {"section_id": {"type": "string"}, "run_id": TEAM_IDS["run_id"], **GRANT_PROP}, "required": ["section_id", "run_id", "grant"]},
            lambda p, **_: request("GET", f"/internal/hermes/sections/{quote(p['section_id'], safe='')}{_run_query(p)}", grant=p.get("grant")),
        ),
        (
            "waypoint_propose_tasks",
            "Propose task changes; nothing changes until the team accepts. task_split: new tasks for every member "
            "(tasks). task_edit: change one to-do task (task_id, changes). task_delete: remove to-do tasks (task_ids, "
            "rationale). task_reorganize: re-split existing to-do work in one vote: task_changes [{task_id, title?, "
            "description?, estimate_points?, assignee_id?, milestone_id?}], task_ids to delete, tasks to add, rationale. "
            "task_merge: compress 2-10 to-do tasks into one (task_ids, the first is kept; into {title, description, "
            "estimate_points, assignee_id?, milestone_id?}; rationale). An uneven workload is shown to the team as a "
            "warning, not refused; tasks in Doing, Review or Done can never be changed. For several changes at once, "
            "use waypoint_propose_batch.",
            {
                "type": "object",
                "properties": {
                    **TEAM_IDS, **GRANT_PROP,
                    "kind": {"type": "string", "enum": ["task_split", "task_edit", "task_delete", "task_reorganize", "task_merge"]},
                    "summary": {"type": "string", "description": "One line shown on the proposal card"},
                    "tasks": {"type": "array", "items": {"type": "object", "properties": {
                        "title": {"type": "string"}, "description": {"type": "string"}, "assignee_id": {"type": "string"},
                        "estimate_points": {"type": "integer", "minimum": 1, "maximum": 8}, "milestone_id": {"type": "string"},
                        "depends_on": {"type": "array", "items": {"type": "string"}}, "rationale": {"type": "string"},
                    }, "required": ["title", "assignee_id", "estimate_points", "rationale"]}},
                    "task_id": {"type": "string"},
                    "changes": {"type": "object", "properties": {
                        "title": {"type": "string"}, "description": {"type": "string"},
                        "estimate_points": {"type": "integer", "minimum": 1, "maximum": 8}, "assignee_id": {"type": "string"},
                    }},
                    "rationale": {"type": "string"},
                    "task_ids": {"type": "array", "items": {"type": "string"}, "description": "task_delete / task_reorganize: to-do tasks to remove"},
                    "task_changes": {"type": "array", "items": {"type": "object", "properties": {
                        "task_id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"},
                        "estimate_points": {"type": "integer", "minimum": 1, "maximum": 8}, "assignee_id": {"type": "string"},
                        "milestone_id": {"type": "string"},
                    }, "required": ["task_id"]}, "description": "task_reorganize: edits to existing to-do tasks"},
                    "into": {"type": "object", "properties": {
                        "title": {"type": "string"}, "description": {"type": "string"},
                        "estimate_points": {"type": "integer", "minimum": 1, "maximum": 8},
                        "assignee_id": {"type": "string"}, "milestone_id": {"type": "string"},
                    }, "required": ["title", "estimate_points"], "description": "task_merge: the merged task"},
                },
                "required": ["team_id", "run_id", "grant", "kind", "summary"],
            },
            lambda p, **_: _propose(p, p["kind"], _task_payload(p)),
        ),
        (
            "waypoint_propose_batch",
            "Propose many changes as ONE card and ONE vote, applied all-or-nothing in order: prefer this over several "
            "small proposals (e.g. compress eight tasks into three with several task_merge steps). Each op is "
            "{kind, payload} with the payload the endpoint expects: task_split {tasks}, task_edit {task_id, changes}, "
            "task_delete {task_ids, rationale}, task_reorganize {changes, deletes, adds, rationale}, task_merge "
            "{task_ids, into, rationale}, doc_section {section_id, content_md, requirement_ids}, charter {charter}, "
            "milestones {milestones}, section_owners {owners}. Later steps see earlier ones. If any step no longer "
            "fits when the team accepts, the whole batch goes stale and nothing changes.",
            {
                "type": "object",
                "properties": {
                    **TEAM_IDS, **GRANT_PROP,
                    "summary": {"type": "string", "description": "One line shown on the proposal card"},
                    "rationale": {"type": "string"},
                    "ops": {"type": "array", "minItems": 1, "maxItems": 25, "items": {"type": "object", "properties": {
                        "kind": {"type": "string", "enum": ["task_split", "task_edit", "task_delete", "task_reorganize", "task_merge",
                                                           "doc_section", "charter", "milestones", "section_owners"]},
                        "payload": {"type": "object"},
                    }, "required": ["kind", "payload"]}},
                },
                "required": ["team_id", "run_id", "grant", "ops", "summary"],
            },
            lambda p, **_: _propose(p, "batch", {"ops": p.get("ops", []), "rationale": p.get("rationale", "")}),
        ),
        (
            "waypoint_propose_section",
            "Propose a draft for one document section; its owner accepts or rejects it. Follow the waypoint-team-coach "
            "drafting conventions and number requirements FR-1, NFR-1.",
            {
                "type": "object",
                "properties": {
                    **TEAM_IDS, **GRANT_PROP, "section_id": {"type": "string"}, "content_md": {"type": "string"},
                    "requirement_ids": {"type": "array", "items": {"type": "string"}}, "summary": {"type": "string"},
                },
                "required": ["team_id", "run_id", "grant", "section_id", "content_md", "summary"],
            },
            lambda p, **_: _propose(p, "doc_section", {"section_id": p["section_id"], "content_md": p["content_md"], "requirement_ids": p.get("requirement_ids", [])}),
        ),
        (
            "waypoint_propose_team_change",
            "Propose a team-wide change that needs a majority vote: kind charter (payload {charter: {goal, roles: "
            "{user_id: role}, working_agreement: [..], meetings}}), milestones (payload {milestones: [{title, due, "
            "deliverable_key}]}) or section_owners (payload {owners: {section_id: user_id}}).",
            {
                "type": "object",
                "properties": {**TEAM_IDS, **GRANT_PROP, "kind": {"type": "string", "enum": ["charter", "milestones", "section_owners"]},
                               "payload": {"type": "object"}, "summary": {"type": "string"}},
                "required": ["team_id", "run_id", "grant", "kind", "payload", "summary"],
            },
            lambda p, **_: _propose(p, p["kind"], p.get("payload", {})),
        ),
    ]
    for name, description, parameters, handler in tools:
        ctx.register_tool(
            name=name,
            toolset="waypoint-team",
            schema={"name": name, "description": description, "parameters": parameters},
            handler=handler,
        )
