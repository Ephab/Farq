"""The central team plugin must stay a strict, grant-carrying subset of the team tools in the student plugin."""
import importlib.util
import json
import sys
from pathlib import Path

HERMES = Path(__file__).resolve().parents[3] / ".hermes" / "plugins"


def load(name, folder):
    spec = importlib.util.spec_from_file_location(name, HERMES / folder / "__init__.py", submodule_search_locations=[str(HERMES / folder)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Ctx:
    def __init__(self):
        self.tools = {}

    def register_tool(self, name, toolset, schema, handler):
        self.tools[name] = (toolset, schema, handler)


def registered(module):
    ctx = Ctx()
    module.register(ctx)
    return ctx.tools


central_module = load("waypoint_team_plugin", "waypoint-team")
personal = registered(load("waypoint_personal_plugin_for_drift", "waypoint"))
central = registered(central_module)


def strip_grant(schema):
    parameters = json.loads(json.dumps(schema["parameters"]))
    parameters["properties"].pop("grant", None)
    parameters["required"] = [item for item in parameters["required"] if item != "grant"]
    return parameters


def test_only_team_tools_exist_centrally():
    assert set(central) == {"waypoint_get_team_context", "waypoint_get_task", "waypoint_get_doc_section", "waypoint_propose_tasks",
                            "waypoint_propose_batch", "waypoint_propose_section", "waypoint_propose_team_change"}
    assert {toolset for toolset, _, _ in central.values()} == {"waypoint-team"}


def test_schemas_match_the_student_plugin_apart_from_the_grant():
    for name, (_, schema, _) in central.items():
        assert strip_grant(schema) == personal[name][1]["parameters"], name
        assert "grant" in schema["parameters"]["required"] and "run_id" in schema["parameters"]["required"]


def test_calls_carry_the_grant_and_always_a_run_id(monkeypatch):
    calls = []
    monkeypatch.setattr(central_module, "request", lambda method, path, payload=None, grant=None: calls.append((method, path, payload, grant)) or "{}")
    central["waypoint_get_team_context"][2]({"team_id": "t 1", "run_id": "r1", "grant": "g1"})
    central["waypoint_propose_tasks"][2]({"team_id": "t1", "run_id": "r1", "grant": "g1", "kind": "task_delete", "summary": "s", "task_ids": ["a"], "rationale": "r"})
    assert calls[0] == ("GET", "/internal/hermes/teams/t%201/context?run_id=r1", None, "g1")
    method, path, payload, grant = calls[1]
    assert (method, path, grant) == ("POST", "/internal/hermes/teams/t1/proposals", "g1")
    assert payload["run_id"] == "r1" and payload["kind"] == "task_delete"
