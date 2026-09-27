"""Hermes project plugin: the only application capabilities exposed to the coach."""

from urllib.parse import quote

from .scanner import index_folder, read_project_file, scan_folder
from .tools import request

EVIDENCE_KINDS = ["course", "project", "skill", "experience", "certificate", "publication", "activity", "education"]


def _run_query(params: dict) -> str:
    """run_id is optional on the wire: the API falls back to the team's running run."""
    run_id = params.get("run_id")
    return f"?run_id={quote(run_id, safe='')}" if run_id else ""


def _propose(params: dict, kind: str, payload: dict) -> str:
    """Every team change Hermes makes is a proposal the team must accept."""
    body = {"kind": kind, "payload": payload, "summary": params.get("summary", "")}
    if params.get("run_id"):
        body["run_id"] = params["run_id"]
    return request("POST", f"/internal/hermes/teams/{quote(params['team_id'], safe='')}/proposals", body)


def _task_payload(p: dict) -> dict:
    """Shape farq_propose_tasks arguments into the proposal payload for each kind."""
    kind = p["kind"]
    if kind == "task_split":
        return {"tasks": p.get("tasks", [])}
    if kind == "task_delete":
        return {"task_ids": p.get("task_ids", []), "rationale": p.get("rationale", "")}
    if kind == "task_reorganize":
        return {"changes": p.get("task_changes", []), "deletes": p.get("task_ids", []),
                "adds": p.get("tasks", []), "rationale": p.get("rationale", "")}
    return {"task_id": p.get("task_id", ""), "changes": p.get("changes", {}), "rationale": p.get("rationale", "")}


TEAM_IDS = {
    "team_id": {"type": "string", "description": "team_id from the run message header"},
    "run_id": {"type": "string", "description": "run_id from the run message header"},
}


def register(ctx):
    tools = [
        (
            "farq_get_student_context",
            "Read verified facts the student explicitly shared with Farq.",
            {
                "type": "object",
                "properties": {"user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"}},
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/context"),
        ),
        (
            "farq_get_active_roadmap",
            "Read the student's authoritative active roadmap, progress, and version id.",
            {
                "type": "object",
                "properties": {"user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"}},
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/roadmap"),
        ),
        (
            "farq_record_explicit_fact",
            "Store a fact the student stated directly. Use for chat statements and explicit branch choices; never infer facts.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"},
                    "category": {"type": "string", "enum": ["interest", "goal", "course", "skill", "strength", "weakness", "achievement", "preference"]},
                    "key": {"type": "string"},
                    "value": {},
                    "source_message_id": {"type": "string"},
                    "explicit": {"type": "boolean", "const": True},
                    "source_kind": {"type": "string", "enum": ["chat", "branch", "onboarding"], "description": "Use onboarding for answers during the onboarding chat."},
                },
                "required": ["user_id", "category", "key", "value", "source_message_id", "explicit"],
            },
            lambda p, **_: request("POST", "/internal/hermes/facts", p),
        ),
        (
            "farq_get_student_profile",
            "Read the student's onboarding basics plus the evidence they confirmed (courses, grades, projects, skills, experience) and stated facts.",
            {
                "type": "object",
                "properties": {"user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"}},
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/profile"),
        ),
        (
            "farq_index_folder",
            "Index a folder the student typed during onboarding AND submit the results as evidence for their review, in one call. "
            "Use this for folder indexing. Never opens .env files, keys, credentials or identity documents.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"},
                    "source_id": {"type": "string"},
                    "path": {"type": "string"},
                    "purpose": {"type": "string", "enum": ["projects", "coursework"]},
                },
                "required": ["user_id", "source_id", "path", "purpose"],
            },
            lambda p, **_: index_folder(p["user_id"], p["source_id"], p["path"], p.get("purpose", "projects"),
                                        lambda body: request("POST", "/internal/hermes/evidence", body)),
        ),
        (
            "farq_scan_folder",
            "Index a folder on this computer that the student typed during onboarding. Returns a compact manifest "
            "(projects: manifests, README heads, git remotes, file types; coursework: terms, courses, material types). "
            "Never opens .env files, keys, credentials or identity documents.",
            {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "purpose": {"type": "string", "enum": ["projects", "coursework"]},
                },
                "required": ["path", "purpose"],
            },
            lambda p, **_: scan_folder(p["path"], p.get("purpose", "projects")),
        ),
        (
            "farq_read_project_file",
            "Read one small README, manifest or text file found by farq_scan_folder (max 20 KB). Secrets and identity documents are refused.",
            {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Absolute path"}},
                "required": ["path"],
            },
            lambda p, **_: read_project_file(p["path"]),
        ),
        (
            "farq_submit_evidence",
            "Submit evidence found in a scanned folder. It is stored as a suggestion the student must confirm; it never becomes a fact on its own.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"},
                    "source_id": {"type": "string"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "kind": {"type": "string", "enum": EVIDENCE_KINDS},
                                "title": {"type": "string"},
                                "data": {"type": "object"},
                                "source_ref": {"type": "string", "description": "Relative path of the project or course folder"},
                            },
                            "required": ["kind", "title"],
                        },
                    },
                },
                "required": ["user_id", "source_id", "items"],
            },
            lambda p, **_: request("POST", "/internal/hermes/evidence", p),
        ),
        (
            "farq_find_hackathons",
            "Find current Hackathonat opportunities ranked against the student's verified profile and roadmap.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header"},
                    "query": {"type": "string", "description": "Optional interest such as AI, cybersecurity, or startup"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 5, "default": 5},
                },
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/hackathons?query={quote(p.get('query', ''))}&limit={p.get('limit', 5)}"),
        ),
        (
            "farq_find_coop_companies",
            "Find Saudi co-op company matches ranked from the student's verified Farq profile, roadmap and projects.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header"},
                    "query": {"type": "string", "description": "Optional domain such as govtech, AI, research, energy or cybersecurity"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 8, "default": 5},
                },
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/coop/companies?query={quote(p.get('query', ''))}&limit={p.get('limit', 5)}"),
        ),
        (
            "farq_find_coop_postings",
            "Find cached Saudi co-op postings matched to the student, with official, Telegram, LinkedIn, freshness, and demo provenance.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header"},
                    "query": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 8, "default": 5},
                },
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/coop/postings?query={quote(p.get('query', ''))}&limit={p.get('limit', 5)}"),
        ),
        (
            "farq_get_coop_target",
            "Read one authoritative co-op company or posting, including fit reasons, gaps, source status and official links.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "target_type": {"type": "string", "enum": ["company", "posting"]},
                    "target_id": {"type": "string"},
                },
                "required": ["user_id", "target_type", "target_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/coop/{p['target_type']}/{quote(p['target_id'], safe='')}"),
        ),
        (
            "farq_blackboard_list_courses",
            "List the student's courses in Farq's read-only, pre-indexed Blackboard demo snapshot.",
            {
                "type": "object",
                "properties": {"user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header"}},
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/blackboard/courses"),
        ),
        (
            "farq_blackboard_list_content",
            "List compact Blackboard content metadata for one course. Use read_item to retrieve text.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "course_id": {"type": "string"},
                    "content_type": {"type": "string", "enum": ["announcement", "syllabus", "lecture", "document", "assignment"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 30},
                },
                "required": ["user_id", "course_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/blackboard/courses/{p['course_id']}/content?content_type={quote(p.get('content_type', ''))}&limit={p.get('limit', 30)}"),
        ),
        (
            "farq_blackboard_search",
            "Search titles and extracted text across the student's pre-indexed Blackboard content. Returns short snippets, not full documents.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "query": {"type": "string", "minLength": 2},
                    "course_id": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
                },
                "required": ["user_id", "query"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/blackboard/search?query={quote(p['query'])}&course_id={quote(p.get('course_id', ''))}&limit={p.get('limit', 8)}"),
        ),
        (
            "farq_blackboard_read_item",
            "Read one bounded text chunk from a Blackboard content item. Continue with next_cursor when more text is needed.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "item_id": {"type": "string"},
                    "cursor": {"type": "integer", "minimum": 0, "default": 0},
                },
                "required": ["user_id", "item_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/blackboard/items/{p['item_id']}?cursor={p.get('cursor', 0)}"),
        ),
        (
            "farq_blackboard_list_updates",
            "List recently added or modified Blackboard snapshot items, including demo deadlines and announcements.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "since": {"type": "string", "description": "Optional ISO-8601 timestamp"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 15},
                },
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/blackboard/updates?since={quote(p.get('since') or '1970-01-01T00:00:00Z')}&limit={p.get('limit', 15)}"),
        ),
        (
            "farq_submit_roadmap_proposal",
            "Submit a validated future-only roadmap revision for student review. This never activates the revision.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "The Farq user_id UUID from the run message header (never the student's display name)"},
                    "base_version_id": {"type": "string"},
                    "summary": {"type": "string"},
                    "reasoning": {"type": "string"},
                    "operations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "type": {"type": "string", "enum": ["add_node", "update_node", "remove_node", "move_node", "set_dependencies"]},
                                "node_id": {"type": "string"},
                                "node": {"type": ["object", "null"]},
                                "changes": {"type": ["object", "null"]},
                                "stage_id": {"type": ["string", "null"]},
                                "position": {"type": ["integer", "null"]},
                                "dependencies": {"type": ["array", "null"], "items": {"type": "string"}},
                            },
                            "required": ["type", "node_id"],
                        },
                    },
                },
                "required": ["user_id", "base_version_id", "summary", "reasoning", "operations"],
            },
            lambda p, **_: request("POST", "/internal/hermes/roadmap-proposals", p),
        ),
        (
            "farq_get_project",
            "Read one project's accepted brief, rubric, progress, and evaluation history.",
            {
                "type": "object",
                "properties": {"project_id": {"type": "string"}},
                "required": ["project_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/projects/{p['project_id']}"),
        ),
        (
            "farq_submit_project_refinement",
            "Submit a refined project brief as a draft. The student must explicitly accept it before it changes the roadmap.",
            {
                "type": "object",
                "properties": {
                    "project_id": {"type": "string"},
                    "brief": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"}, "problem": {"type": "string"}, "objective": {"type": "string"},
                            "deliverables": {"type": "array", "items": {"type": "string"}},
                            "milestones": {"type": "array", "items": {"type": "string"}},
                            "constraints": {"type": "array", "items": {"type": "string"}},
                            "tools": {"type": "array", "items": {"type": "string"}},
                            "resources": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "url": {"type": "string"}}, "required": ["label", "url"]}},
                            "rubric": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "weight": {"type": "integer"}}, "required": ["id", "title", "weight"]}},
                        },
                        "required": ["title", "problem", "objective", "deliverables", "rubric"],
                    },
                    "source": {"type": "string", "const": "hermes"},
                },
                "required": ["project_id", "brief"],
            },
            lambda p, **_: request("POST", f"/internal/hermes/projects/{p['project_id']}/refinements", {"brief": p["brief"], "source": "hermes"}),
        ),
        (
            "farq_get_team_context",
            "Read a Farq course team as the member who started this run: assignment brief and rubric, teammate cards "
            "(stated skills, goals and roadmap stage), tasks, milestones, decisions, document outline, open proposals "
            "and, for members, the last 50 chat messages. Call this before any claim about the team.",
            {"type": "object", "properties": dict(TEAM_IDS), "required": ["team_id", "run_id"]},
            lambda p, **_: request("GET", f"/internal/hermes/teams/{quote(p['team_id'], safe='')}/context{_run_query(p)}"),
        ),
        (
            "farq_get_task",
            "Read one team task in full.",
            {"type": "object", "properties": {"task_id": {"type": "string"}, "run_id": TEAM_IDS["run_id"]}, "required": ["task_id", "run_id"]},
            lambda p, **_: request("GET", f"/internal/hermes/tasks/{quote(p['task_id'], safe='')}{_run_query(p)}"),
        ),
        (
            "farq_get_doc_section",
            "Read one SRS/SDS/SPMP section in full, including its owner and status.",
            {"type": "object", "properties": {"section_id": {"type": "string"}, "run_id": TEAM_IDS["run_id"]}, "required": ["section_id", "run_id"]},
            lambda p, **_: request("GET", f"/internal/hermes/sections/{quote(p['section_id'], safe='')}{_run_query(p)}"),
        ),
        (
            "farq_propose_tasks",
            "Propose task changes; nothing changes until the team accepts. task_split: new tasks for every member "
            "(tasks). task_edit: change one to-do task (task_id, changes). task_delete: remove to-do tasks (task_ids, "
            "rationale). task_reorganize: re-split existing to-do work in one vote: task_changes [{task_id, title?, "
            "estimate_points?, assignee_id?}], task_ids to delete, tasks to add, rationale. Open points must stay "
            "balanced; tasks in Doing, Review or Done can never be changed.",
            {
                "type": "object",
                "properties": {
                    **TEAM_IDS,
                    "kind": {"type": "string", "enum": ["task_split", "task_edit", "task_delete", "task_reorganize"]},
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
                        "task_id": {"type": "string"}, "title": {"type": "string"},
                        "estimate_points": {"type": "integer", "minimum": 1, "maximum": 8}, "assignee_id": {"type": "string"},
                    }, "required": ["task_id"]}, "description": "task_reorganize: edits to existing to-do tasks"},
                },
                "required": ["team_id", "run_id", "kind", "summary"],
            },
            lambda p, **_: _propose(p, p["kind"], _task_payload(p)),
        ),
        (
            "farq_propose_section",
            "Propose a draft for one document section; its owner accepts or rejects it. Follow the farq-team-coach "
            "drafting conventions and number requirements FR-1, NFR-1.",
            {
                "type": "object",
                "properties": {
                    **TEAM_IDS, "section_id": {"type": "string"}, "content_md": {"type": "string"},
                    "requirement_ids": {"type": "array", "items": {"type": "string"}}, "summary": {"type": "string"},
                },
                "required": ["team_id", "run_id", "section_id", "content_md", "summary"],
            },
            lambda p, **_: _propose(p, "doc_section", {"section_id": p["section_id"], "content_md": p["content_md"], "requirement_ids": p.get("requirement_ids", [])}),
        ),
        (
            "farq_propose_team_change",
            "Propose a team-wide change that needs a majority vote: kind charter (payload {charter: {goal, roles: "
            "{user_id: role}, working_agreement: [..], meetings}}), milestones (payload {milestones: [{title, due, "
            "deliverable_key}]}) or section_owners (payload {owners: {section_id: user_id}}).",
            {
                "type": "object",
                "properties": {**TEAM_IDS, "kind": {"type": "string", "enum": ["charter", "milestones", "section_owners"]},
                               "payload": {"type": "object"}, "summary": {"type": "string"}},
                "required": ["team_id", "run_id", "kind", "payload", "summary"],
            },
            lambda p, **_: _propose(p, p["kind"], p.get("payload", {})),
        ),
    ]
    for name, description, parameters, handler in tools:
        ctx.register_tool(
            name=name,
            toolset="farq",
            schema={"name": name, "description": description, "parameters": parameters},
            handler=handler,
        )

