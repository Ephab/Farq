"""Regression tests for the Plan 2 whole-branch review findings."""
import threading
import time

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams import hermes_team
from app.teams import proposals as proposals_module
from app.teams.chat import post_message
from app.teams.models import Team, TeamAgentRun, TeamProposal
from app.teams.proposals import ProposalError, create_proposal

INTERNAL = {"X-Waypoint-Internal-Token": "waypoint-internal-dev"}


def _propose(team_id, kind, payload, invoked_by):
    db = SessionLocal()
    try:
        proposal = create_proposal(db, db.get(Team, team_id), kind, payload, summary="Hermes proposal", invoked_by=invoked_by)
        db.commit()
        return proposal.id
    finally:
        db.close()


def _task(client, team, lead, **body):
    return client.post(f"/api/teams/{team}/tasks", json={"title": "ERD", **body}, headers=hdr(lead)).json()


def _task_state(client, team, user, task_id):
    return next(item for item in client.get(f"/api/teams/{team}/state", headers=hdr(user)).json()["tasks"] if item["id"] == task_id)


def _running_run(team_id, user_id):
    db = SessionLocal()
    try:
        run = TeamAgentRun(team_id=team_id, invoked_by_user_id=user_id, trigger_message_id="m", command="mention", status="running")
        db.add(run)
        db.commit()
        return run.id
    finally:
        db.close()


def test_accepting_a_description_only_edit_keeps_other_fields(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    task = _task(client, team, s0, assignee_id=s1, estimate_points=3)
    proposal_id = _propose(team, "task_edit", {"task_id": task["id"], "changes": {"description": "Include all entities"}}, s0)
    decided = client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1))
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "applied"
    saved = _task_state(client, team, s0, task["id"])
    assert (saved["title"], saved["estimate_points"], saved["assignee_id"], saved["description"]) == ("ERD", 3, s1, "Include all entities")


def test_explicit_null_title_is_rejected(client):
    world = make_world()
    task = _task(client, world["team_id"], world["students"][0])
    with pytest.raises(ProposalError, match="title"):
        _propose(world["team_id"], "task_edit", {"task_id": task["id"], "changes": {"title": None}}, world["students"][0])


def test_concurrent_votes_apply_a_proposal_once(client, monkeypatch):
    world = make_world(students=5, team_members=5)
    team, members = world["team_id"], world["students"]
    split = {"tasks": [{"title": f"Part {n}", "assignee_id": m, "estimate_points": 2, "rationale": "r"} for n, m in enumerate(members)]}
    proposal_id = _propose(team, "task_split", split, members[0])
    for member in members[:2]:
        client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(member))
    real = proposals_module.members_of

    def slow(db, team_id):
        time.sleep(0.05)  # widen the read-check-write window
        return real(db, team_id)

    monkeypatch.setattr(proposals_module, "members_of", slow)
    threads = [threading.Thread(target=client.post, args=(f"/api/proposals/{proposal_id}/vote",), kwargs={"json": {"vote": "up"}, "headers": hdr(member)}) for member in members[2:]]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert [event["type"] for event in events_for(team)].count("proposal.applied") == 1
    state = client.get(f"/api/teams/{team}/state", headers=hdr(members[0])).json()
    assert len([task for task in state["tasks"] if task["created_by"] == "hermes"]) == 5


def test_internal_tools_act_as_the_run_invoker_not_the_model(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    db = SessionLocal()
    try:
        post_message(db, team, None, "Secret for student one", kind="notice", visible_to_user_id=s1)
        db.commit()
    finally:
        db.close()
    run_id = _running_run(team, s0)
    context = client.get(f"/internal/hermes/teams/{team}/context", params={"run_id": run_id, "acting_user_id": s1}, headers=INTERNAL)
    assert context.status_code == 200, context.text
    assert context.json()["acting_user"]["id"] == s0
    assert "Secret for student one" not in str(context.json())


def test_internal_tools_reject_foreign_or_finished_runs(client):
    first, second = make_world(), make_world()
    run_id = _running_run(first["team_id"], first["students"][0])
    assert client.get(f"/internal/hermes/teams/{second['team_id']}/context", params={"run_id": run_id}, headers=INTERNAL).status_code == 403
    db = SessionLocal()
    try:
        db.get(TeamAgentRun, run_id).status = "completed"
        db.commit()
    finally:
        db.close()
    assert client.get(f"/internal/hermes/teams/{first['team_id']}/context", params={"run_id": run_id}, headers=INTERNAL).status_code == 403


def test_catchup_keeps_the_newest_events_when_there_are_many(client, monkeypatch):
    calls = []

    def fake(client_, headers, payload, provider, model, timeout_seconds, on_state=None, hermes_api_key=None):
        calls.append(payload)
        return "Digest.", "fake-model", "gemini"

    monkeypatch.setattr(hermes_team, "execute_with_fallback", fake)
    monkeypatch.setattr(hermes_team, "effective_hermes_key", lambda override: "k" * 32)
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    db = SessionLocal()
    try:
        for index in range(210):
            post_message(db, team, s1, f"msg number {index}")
        db.commit()
    finally:
        db.close()
    client.post(f"/api/teams/{team}/messages", json={"content": "/catchup"}, headers=hdr(s0))
    prompt = calls[-1]["input"]
    assert "msg number 209" in prompt
    assert "Older events omitted" in prompt


def test_edit_goes_stale_when_the_task_changes_hands(client):
    world = make_world()
    team, s0, s1, s2 = world["team_id"], world["students"][0], world["students"][1], world["students"][2]
    task = _task(client, team, s0, assignee_id=s1)
    proposal_id = _propose(team, "task_edit", {"task_id": task["id"], "changes": {"description": "New"}}, s0)
    client.patch(f"/api/tasks/{task['id']}", json={"assignee_id": s2}, headers=hdr(s0))
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).json()["status"] == "stale"
    assert _task_state(client, team, s0, task["id"])["description"] == ""


def test_draft_goes_stale_when_the_section_was_saved_meanwhile(client):
    world = make_world()
    team, s0, s1, s2 = world["team_id"], world["students"][0], world["students"][1], world["students"][2]
    document = client.post(f"/api/teams/{team}/documents", json={"kind": "srs"}, headers=hdr(s0)).json()
    section = next(item for item in document["sections"] if item["key"] == "3.2")
    client.patch(f"/api/sections/{section['id']}", json={"owner_user_id": s1}, headers=hdr(s0))
    proposal_id = _propose(team, "doc_section", {"section_id": section["id"], "content_md": "Hermes text"}, s0)
    client.post(f"/api/sections/{section['id']}/lock", headers=hdr(s2))
    client.put(f"/api/sections/{section['id']}/content", json={"content_md": "Manual text", "version": 0}, headers=hdr(s2))
    client.post(f"/api/sections/{section['id']}/unlock", headers=hdr(s2))
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).json()["status"] == "stale"
    sections = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["documents"][0]["sections"]
    assert next(item for item in sections if item["key"] == "3.2")["content_md"] == "Manual text"


def test_internal_tools_fall_back_to_the_teams_running_run(client):
    """Models sometimes omit run_id; the team's single running run still decides who Hermes acts as."""
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    assert client.get(f"/internal/hermes/teams/{team}/context", headers=INTERNAL).status_code == 403
    _running_run(team, s1)
    context = client.get(f"/internal/hermes/teams/{team}/context", params={"acting_user_id": s0}, headers=INTERNAL)
    assert context.status_code == 200, context.text
    assert context.json()["acting_user"]["id"] == s1
    fair = {"tasks": [{"title": f"Part {n}", "assignee_id": m, "estimate_points": 2, "rationale": "r"} for n, m in enumerate(world["students"][:3])]}
    created = client.post(f"/internal/hermes/teams/{team}/proposals", json={"kind": "task_split", "payload": fair, "summary": "Split"}, headers=INTERNAL)
    assert created.status_code == 201, created.text
    assert created.json()["proposal"]["invoked_by"] == s1
