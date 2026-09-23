"""Hermes project plugin: the only application capabilities exposed to the coach."""

from .tools import request


def register(ctx):
    tools = [
        (
            "farq_get_student_context",
            "Read verified facts the student explicitly shared with Farq.",
            {
                "type": "object",
                "properties": {"user_id": {"type": "string"}},
                "required": ["user_id"],
            },
            lambda p, **_: request("GET", f"/internal/hermes/students/{p['user_id']}/context"),
        ),
        (
            "farq_get_active_roadmap",
            "Read the student's authoritative active roadmap, progress, and version id.",
            {
                "type": "object",
                "properties": {"user_id": {"type": "string"}},
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
                    "user_id": {"type": "string"},
                    "category": {"type": "string", "enum": ["interest", "goal", "course", "skill", "strength", "weakness", "achievement", "preference"]},
                    "key": {"type": "string"},
                    "value": {},
                    "source_message_id": {"type": "string"},
                    "explicit": {"type": "boolean", "const": True},
                },
                "required": ["user_id", "category", "key", "value", "source_message_id", "explicit"],
            },
            lambda p, **_: request("POST", "/internal/hermes/facts", p),
        ),
        (
            "farq_submit_roadmap_proposal",
            "Submit a validated future-only roadmap revision for student review. This never activates the revision.",
            {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
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

