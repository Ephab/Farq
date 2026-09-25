"""Hermes project plugin: the only application capabilities exposed to the coach."""

from urllib.parse import quote

from .scanner import index_folder, read_project_file, scan_folder
from .tools import request

EVIDENCE_KINDS = ["course", "project", "skill", "experience", "certificate", "publication", "activity", "education"]


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
    ]
    for name, description, parameters, handler in tools:
        ctx.register_tool(
            name=name,
            toolset="farq",
            schema={"name": name, "description": description, "parameters": parameters},
            handler=handler,
        )

