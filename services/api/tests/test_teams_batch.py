"""Batch proposals, task merge, team project ops and the lead override."""
import json

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import Team, TeamProposal
from app.teams.proposals import ProposalError, create_proposal


def _propose(team_id, kind, payload, invoked_by):
    db = SessionLocal()
    try:
        proposal = create_proposal(db, db.get(Team, team_id), kind, payload, summary="Hermes proposal", invoked_by=invoked_by)
        db.commit()
        return proposal.id
    finally:
        db.close()


def _proposal(proposal_id):
    db = SessionLocal()
    try:
        return db.get(TeamProposal, proposal_id)
    finally:
        db.close()


def _task(client, team, actor, title, assignee, points=2, **extra):
    return client.post(f"/api/teams/{team}/tasks", json={"title": title, "assignee_id": assignee, "estimate_points": points, **extra}, headers=hdr(actor)).json()


def _state(client, team, user):
    return client.get(f"/api/teams/{team}/state", headers=hdr(user)).json()


def _tasks(client, team, user):
    return {task["id"]: task for task in _state(client, team, user)["tasks"]}


def _vote_through(client, proposal_id, members):
    result = None
    for member in members[:2]:
        result = client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(member)).json()
    return result


def test_merge_compresses_many_tasks_and_repoints_dependents(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    a, b, c = (_task(client, team, s0, title, s1, 3) for title in ("Login form", "Signup form", "Reset form"))
    later = _task(client, team, s0, "E2E tests", s2, 2, depends_on=[b["id"], c["id"]])
    proposal_id = _propose(team, "task_merge", {
        "task_ids": [a["id"], b["id"], c["id"]],
        "into": {"title": "Auth forms", "description": "Login, signup and reset", "estimate_points": 6},
        "rationale": "One component, one owner",
    }, s0)
    assert _vote_through(client, proposal_id, [s0, s1, s2])["status"] == "applied"
    tasks = _tasks(client, team, s0)
    assert b["id"] not in tasks and c["id"] not in tasks
    merged = tasks[a["id"]]
    assert (merged["title"], merged["estimate_points"], merged["assignee_id"]) == ("Auth forms", 6, s1)
    assert tasks[later["id"]]["depends_on"] == [a["id"]]


def test_merge_refuses_work_in_progress(client):
    world = make_world()
    team, (s0, s1) = world["team_id"], world["students"][:2]
    a, b = _task(client, team, s0, "A", s1), _task(client, team, s0, "B", s1)
    client.post(f"/api/tasks/{b['id']}/move", json={"status": "doing"}, headers=hdr(s1))
    with pytest.raises(ProposalError, match="only to-do"):
        _propose(team, "task_merge", {"task_ids": [a["id"], b["id"]], "into": {"title": "AB", "estimate_points": 3}, "rationale": "r"}, s0)


def test_batch_applies_every_step_in_one_vote(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    tasks = [_task(client, team, s0, f"T{n}", member, 2) for n, member in enumerate((s0, s1, s2, s0, s1, s2))]
    proposal_id = _propose(team, "batch", {"rationale": "Compress the board", "ops": [
        {"kind": "task_merge", "payload": {"task_ids": [tasks[0]["id"], tasks[3]["id"]], "into": {"title": "T0+T3", "estimate_points": 4}, "rationale": "same"}},
        {"kind": "task_merge", "payload": {"task_ids": [tasks[1]["id"], tasks[4]["id"]], "into": {"title": "T1+T4", "estimate_points": 4}, "rationale": "same"}},
        {"kind": "task_merge", "payload": {"task_ids": [tasks[2]["id"], tasks[5]["id"]], "into": {"title": "T2+T5", "estimate_points": 4}, "rationale": "same"}},
        {"kind": "milestones", "payload": {"milestones": [{"title": "Beta", "due": "2026-11-01T00:00:00Z"}]}},
    ]}, s0)
    proposal = _proposal(proposal_id)
    assert (proposal.kind, proposal.scope) == ("batch", "team")
    assert len(_tasks(client, team, s0)) == 6  # nothing changes before the vote
    assert _vote_through(client, proposal_id, [s0, s1, s2])["status"] == "applied"
    state = _state(client, team, s0)
    assert sorted(task["title"] for task in state["tasks"]) == ["T0+T3", "T1+T4", "T2+T5"]
    assert "Beta" in [item["title"] for item in state["milestones"]]


def test_batch_rejects_a_bad_step_with_its_index(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    with pytest.raises(ProposalError, match=r"Step 2 \(task_delete\)"):
        _propose(team, "batch", {"ops": [
            {"kind": "milestones", "payload": {"milestones": [{"title": "Beta"}]}},
            {"kind": "task_delete", "payload": {"task_ids": ["missing"], "rationale": "r"}},
        ]}, s0)
    with pytest.raises(ProposalError, match="cannot contain another batch"):
        _propose(team, "batch", {"ops": [{"kind": "batch", "payload": {"ops": []}}]}, s0)


def test_batch_goes_stale_as_a_whole_and_changes_nothing(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    a, b = _task(client, team, s0, "A", s1), _task(client, team, s0, "B", s2)
    proposal_id = _propose(team, "batch", {"ops": [
        {"kind": "task_reorganize", "payload": {"changes": [{"task_id": a["id"], "title": "A renamed"}], "rationale": "r"}},
        {"kind": "task_delete", "payload": {"task_ids": [b["id"]], "rationale": "r"}},
    ]}, s0)
    client.post(f"/api/tasks/{b['id']}/move", json={"status": "doing"}, headers=hdr(s2))
    result = _vote_through(client, proposal_id, [s0, s1, s2])
    assert result["status"] == "stale"
    tasks = _tasks(client, team, s0)
    assert tasks[a["id"]]["title"] == "A" and b["id"] in tasks
    stale = [event for event in events_for(team) if event["type"] == "proposal.stale"][-1]
    assert "Step 2" in stale["payload"]["reason"]


def test_batch_of_personal_steps_for_one_member_goes_to_that_member(client):
    world = make_world()
    team, (s0, s1) = world["team_id"], world["students"][:2]
    a, b = _task(client, team, s0, "A", s1), _task(client, team, s0, "B", s1)
    proposal_id = _propose(team, "batch", {"ops": [
        {"kind": "task_edit", "payload": {"task_id": a["id"], "changes": {"description": "More detail"}}},
        {"kind": "task_edit", "payload": {"task_id": b["id"], "changes": {"estimate_points": 3}}},
    ]}, s0)
    proposal = _proposal(proposal_id)
    assert (proposal.scope, proposal.affected_user_id) == ("personal", s1)
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).json()["status"] == "applied"
    tasks = _tasks(client, team, s1)
    assert (tasks[a["id"]]["description"], tasks[b["id"]]["estimate_points"]) == ("More detail", 3)


def test_project_ops_set_the_team_brief_and_create_outlines(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    proposal_id = _propose(team, "batch", {"ops": [
        {"kind": "brief", "payload": {"problem": "Clinics lose paper records", "objective": "A booking app", "tools": ["React"]}},
        {"kind": "deliverables", "payload": {"deliverables": [
            {"key": "srs", "title": "Requirements spec", "due": "2026-10-20T00:00:00Z", "doc_kind": "srs"},
            {"key": "demo", "title": "Final demo", "due": "2026-12-10T00:00:00Z"},
        ]}},
        {"kind": "rubric", "payload": {"criteria": [{"name": "Requirements", "weight": 40}, {"name": "Demo", "weight": 50}]}},
    ]}, s0)
    assert _proposal(proposal_id).scope == "team"
    card = next(item for item in _state(client, team, s0)["proposals"] if item["id"] == proposal_id)
    assert card["warnings"] == ["Rubric weights add up to 90, not 100"]
    assert _vote_through(client, proposal_id, [s0, s1, s2])["status"] == "applied"
    state = _state(client, team, s0)
    project = state["team"]["project"]
    assert project["brief"]["problem"] == "Clinics lose paper records"
    assert [item["key"] for item in project["deliverables"]] == ["srs", "demo"]
    assert [item["name"] for item in project["rubric"]] == ["Requirements", "Demo"]
    assert [document["kind"] for document in state["documents"]] == ["srs"]
    # The shared assignment brief is untouched.
    assert "Clinics" not in json.dumps(state["team"]["assignment"])


def test_lead_can_force_accept_a_team_vote(client):
    world = make_world()
    team, (s0, s1) = world["team_id"], world["students"][:2]
    proposal_id = _propose(team, "milestones", {"milestones": [{"title": "Kickoff"}]}, s1)
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).status_code == 409
    result = client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s0)).json()
    assert (result["status"], result["decided_via"]) == ("applied", "lead_override")
    applied = [event for event in events_for(team) if event["type"] == "proposal.applied"][-1]
    assert applied["payload"]["decided_via"] == "lead_override"


def test_lead_can_force_reject_another_members_personal_proposal(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    task = _task(client, team, s0, "ERD", s1)
    proposal_id = _propose(team, "task_edit", {"task_id": task["id"], "changes": {"title": "ERD v2"}}, s2)
    assert client.post(f"/api/proposals/{proposal_id}/reject", headers=hdr(s2)).status_code == 403
    result = client.post(f"/api/proposals/{proposal_id}/reject", headers=hdr(s0)).json()
    assert (result["status"], result["decided_via"]) == ("rejected", "lead_override")
    assert _tasks(client, team, s0)[task["id"]]["title"] == "ERD"


def test_instructor_cannot_use_the_lead_override(client):
    world = make_world()
    team, s1 = world["team_id"], world["students"][1]
    proposal_id = _propose(team, "milestones", {"milestones": [{"title": "Kickoff"}]}, s1)
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(world["instructor"])).status_code == 403
