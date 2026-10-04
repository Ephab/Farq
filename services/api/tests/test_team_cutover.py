"""Moving a local team to the shared service: explicit, one-way, privacy-preserving, and crash safe."""
import json
import time
from types import SimpleNamespace

import httpx
import pytest

from app import collab_coach
from app.database import SessionLocal
from app.teams import cutover
from app.teams.models import TeamCutover, TeamMessage

from team_world import client, hdr, make_world  # noqa: F401

CENTRAL = "https://central.test"


class Broker:
    def __init__(self, signed_in=True):
        self.config = SimpleNamespace(api_origin=CENTRAL)
        self.signed_in = signed_in

    def token(self, session):
        return {"access_token": "central-bearer", "expires_at": time.time() + 600} if self.signed_in else None


@pytest.fixture
def central(monkeypatch):
    state = SimpleNamespace(broker=Broker(), calls=[], reply=None)
    monkeypatch.setattr(collab_coach, "_session_for", lambda request, response: (state.broker, "session"))

    def post(url, json=None, **kwargs):
        state.calls.append((url, json, kwargs))
        status, body = state.reply(json) if state.reply else (200, {"dry_run": json["dry_run"], "counts": {"tasks": len(json["bundle"]["tasks"])}, "team_id": "c" * 36})
        return httpx.Response(status, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(cutover.httpx, "post", post)
    return state


def seeded(client_):
    world = make_world(students=3, team_members=2)
    lead, member = world["students"][0], world["students"][1]
    task = client_.post(f"/api/teams/{world['team_id']}/tasks", json={"title": "Write intro", "assignee_id": member}, headers=hdr(lead))
    assert task.status_code == 201, task.text
    client_.post(f"/api/teams/{world['team_id']}/messages", json={"content": "private chat line"}, headers=hdr(member))
    return world, lead, member


def move(client_, world, who, **body):
    return client_.post(f"/api/collaboration/auth/teams/{world['team_id']}/move", json=body, headers=hdr(who))


def test_dry_run_sends_the_bundle_without_chat_or_facts_and_freezes_nothing(client, central):
    world, lead, member = seeded(client)
    answer = move(client, world, lead)
    assert answer.status_code == 200, answer.text
    assert answer.json()["moved"] is False and central.calls[0][1]["dry_run"] is True
    url, payload, kwargs = central.calls[0]
    assert url == CENTRAL + "/v1/teams/import" and kwargs["headers"]["Authorization"] == "Bearer central-bearer"
    assert kwargs["headers"]["X-Waypoint-Client-Version"] == "0.1.0"
    bundle = payload["bundle"]
    assert payload["importer_local_id"] == lead and [m["is_lead"] for m in bundle["members"]].count(True) == 1
    assert bundle["tasks"][0]["assignee_local_id"] == member
    text = json.dumps(payload)
    assert "private chat line" not in text and "facts" not in text and "roadmap" not in text
    assert set(bundle) == {"version", "source_team_id", "name", "charter", "assignment_override", "project", "members", "milestones", "tasks", "decisions", "documents"}
    with SessionLocal() as db:
        assert db.get(TeamCutover, world["team_id"]) is None
    assert client.post(f"/api/teams/{world['team_id']}/tasks", json={"title": "Still writable"}, headers=hdr(lead)).status_code == 201


def test_a_real_move_needs_confirm_and_lead_and_sign_in(client, central):
    world, lead, member = seeded(client)
    assert move(client, world, lead, dry_run=False).status_code == 422
    assert move(client, world, member, dry_run=False, confirm=True).status_code == 403
    central.broker.signed_in = False
    assert move(client, world, lead, dry_run=False, confirm=True).status_code == 401
    assert central.calls == []


def test_move_freezes_every_local_write_but_keeps_reading(client, central):
    world, lead, member = seeded(client)
    answer = move(client, world, lead, dry_run=False, confirm=True)
    assert answer.status_code == 200 and answer.json()["moved"] is True and answer.json()["shared_team_id"] == "c" * 36
    team = world["team_id"]
    for who in (lead, member):
        assert client.post(f"/api/teams/{team}/tasks", json={"title": "after"}, headers=hdr(who)).status_code == 409
        assert client.post(f"/api/teams/{team}/messages", json={"content": "after"}, headers=hdr(who)).status_code == 409
    assert client.get(f"/api/teams/{team}/state", headers=hdr(member)).status_code == 200
    assert move(client, world, lead, dry_run=False, confirm=True).status_code == 409
    with SessionLocal() as db:
        assert db.get(TeamCutover, team).central_team_id == "c" * 36
    cards = client.get("/api/me/teams-home", headers=hdr(member)).json()["teams"]
    assert [card["moved"] for card in cards if card["id"] == team] == [True]


def test_central_refusals_pass_through_and_leave_the_local_team_writable(client, central):
    world, lead, member = seeded(client)
    central.reply = lambda payload: (422, {"detail": "Only the team's lead can move it to the shared service"})
    answer = move(client, world, lead, dry_run=False, confirm=True)
    assert answer.status_code == 422 and "lead" in answer.json()["detail"]
    central.reply = lambda payload: (500, {"detail": "internal secret details"})
    answer = move(client, world, lead, dry_run=False, confirm=True)
    assert answer.status_code == 502 and "secret" not in answer.text
    assert client.post(f"/api/teams/{world['team_id']}/tasks", json={"title": "ok"}, headers=hdr(lead)).status_code == 201
    with SessionLocal() as db:
        assert db.get(TeamCutover, world["team_id"]) is None


def test_validation_errors_from_the_service_are_summarised_not_hidden(client, central):
    world, lead, member = seeded(client)
    central.reply = lambda payload: (422, {"detail": [{"loc": ["body", "bundle", "tasks", 0, "id"], "msg": "String should match pattern", "input": "secret-ish"}]})
    answer = move(client, world, lead)
    assert answer.status_code == 422 and "tasks.0.id" in answer.json()["detail"] and "secret-ish" not in answer.text


def test_an_import_that_succeeded_centrally_but_not_here_is_finished_on_retry(client, central):
    world, lead, member = seeded(client)
    shared = "d" * 36
    central.reply = lambda payload: (409, {"detail": f"This team was already moved (shared project {shared})"})
    answer = move(client, world, lead, dry_run=False, confirm=True)
    assert answer.status_code == 200 and answer.json()["shared_team_id"] == shared
    assert client.post(f"/api/teams/{world['team_id']}/tasks", json={"title": "after"}, headers=hdr(lead)).status_code == 409
    other, other_lead, _ = seeded(client)
    assert move(client, other, other_lead, dry_run=True).status_code == 409  # a dry run never records a move


def test_reopen_is_a_local_script_not_an_api_route(client, central, monkeypatch):
    import importlib.util
    from pathlib import Path
    script = Path(__file__).resolve().parents[3] / "scripts" / "legacy_cutover.py"
    spec = importlib.util.spec_from_file_location("legacy_cutover", script)
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    world, lead, member = seeded(client)
    move(client, world, lead, dry_run=False, confirm=True)
    assert any(row[0] == world["team_id"] for row in tool.status())
    for method in ("delete", "patch", "put"):
        assert getattr(client, method)(f"/api/collaboration/auth/teams/{world['team_id']}/move", headers=hdr(lead)).status_code in {404, 405}
    assert tool.reopen(world["team_id"]) is True and tool.reopen(world["team_id"]) is False
    assert client.post(f"/api/teams/{world['team_id']}/tasks", json={"title": "back"}, headers=hdr(lead)).status_code == 201
