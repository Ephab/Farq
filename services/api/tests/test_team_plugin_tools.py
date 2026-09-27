import importlib.util
import json
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[3] / ".hermes" / "plugins" / "farq"
spec = importlib.util.spec_from_file_location("farq_plugin", PLUGIN_DIR / "__init__.py", submodule_search_locations=[str(PLUGIN_DIR)])
plugin = importlib.util.module_from_spec(spec)
sys.modules["farq_plugin"] = plugin
spec.loader.exec_module(plugin)

TEAM_TOOLS = {"farq_get_team_context", "farq_get_task", "farq_get_doc_section", "farq_propose_tasks", "farq_propose_section", "farq_propose_team_change"}


class Ctx:
    def __init__(self):
        self.tools = {}

    def register_tool(self, name, toolset, schema, handler):
        self.tools[name] = (schema, handler)


def _registered(monkeypatch):
    calls = []
    monkeypatch.setattr(plugin, "request", lambda method, path, payload=None: calls.append((method, path, payload)) or json.dumps({"ok": True}))
    ctx = Ctx()
    plugin.register(ctx)
    return ctx.tools, calls


def test_team_tools_are_registered_with_required_ids(monkeypatch):
    tools, _ = _registered(monkeypatch)
    assert TEAM_TOOLS <= set(tools)
    for name in TEAM_TOOLS:
        assert "run_id" in tools[name][0]["parameters"]["required"]


def test_team_tools_route_to_the_internal_endpoints(monkeypatch):
    tools, calls = _registered(monkeypatch)
    tools["farq_get_team_context"][1]({"team_id": "t 1", "run_id": "r"})
    tools["farq_get_task"][1]({"task_id": "k", "run_id": "r"})
    tools["farq_get_doc_section"][1]({"section_id": "s", "run_id": "r"})
    split = [{"title": "A", "assignee_id": "u", "estimate_points": 2, "rationale": "r"}]
    tools["farq_propose_tasks"][1]({"team_id": "t", "run_id": "r", "kind": "task_split", "tasks": split, "summary": "Split"})
    tools["farq_propose_tasks"][1]({"team_id": "t", "run_id": "r", "kind": "task_edit", "task_id": "k", "changes": {"title": "B"}, "rationale": "r", "summary": "Edit"})
    tools["farq_propose_section"][1]({"team_id": "t", "run_id": "r", "section_id": "s", "content_md": "FR-1", "summary": "Draft"})
    tools["farq_propose_team_change"][1]({"team_id": "t", "run_id": "r", "kind": "charter", "payload": {"charter": {"goal": "g"}}, "summary": "Charter"})
    assert calls[0] == ("GET", "/internal/hermes/teams/t%201/context?run_id=r", None)
    assert calls[1] == ("GET", "/internal/hermes/tasks/k?run_id=r", None)
    assert calls[2] == ("GET", "/internal/hermes/sections/s?run_id=r", None)
    assert calls[3] == ("POST", "/internal/hermes/teams/t/proposals", {"run_id": "r", "kind": "task_split", "payload": {"tasks": split}, "summary": "Split"})
    assert calls[4][2]["payload"] == {"task_id": "k", "changes": {"title": "B"}, "rationale": "r"}
    assert calls[5][2] == {"run_id": "r", "kind": "doc_section", "payload": {"section_id": "s", "content_md": "FR-1", "requirement_ids": []}, "summary": "Draft"}
    assert calls[6][2]["payload"] == {"charter": {"goal": "g"}}


def test_team_tools_tolerate_a_missing_run_id(monkeypatch):
    tools, calls = _registered(monkeypatch)
    tools["farq_get_team_context"][1]({"team_id": "t"})
    tools["farq_propose_section"][1]({"team_id": "t", "section_id": "s", "content_md": "FR-1", "summary": "Draft"})
    assert calls[0] == ("GET", "/internal/hermes/teams/t/context", None)
    assert calls[1][2] == {"kind": "doc_section", "payload": {"section_id": "s", "content_md": "FR-1", "requirement_ids": []}, "summary": "Draft"}


def test_propose_tasks_shapes_delete_and_reorganize_payloads(monkeypatch):
    tools, calls = _registered(monkeypatch)
    propose = tools["farq_propose_tasks"][1]
    propose({"team_id": "t", "kind": "task_delete", "task_ids": ["a"], "rationale": "dup", "summary": "Remove"})
    add = [{"title": "N", "assignee_id": "u", "estimate_points": 2, "rationale": "r"}]
    propose({"team_id": "t", "kind": "task_reorganize", "task_changes": [{"task_id": "b", "assignee_id": "v"}], "task_ids": ["c"], "tasks": add, "rationale": "rebalance", "summary": "Re-split"})
    assert calls[0][2]["payload"] == {"task_ids": ["a"], "rationale": "dup"}
    assert calls[1][2]["payload"] == {"changes": [{"task_id": "b", "assignee_id": "v"}], "deletes": ["c"], "adds": add, "rationale": "rebalance"}
    enum = tools["farq_propose_tasks"][0]["parameters"]["properties"]["kind"]["enum"]
    assert {"task_delete", "task_reorganize"} <= set(enum)
