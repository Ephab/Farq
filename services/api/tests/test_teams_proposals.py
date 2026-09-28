from datetime import datetime, timedelta, timezone

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import Team, TeamProposal
from app.teams.proposals import ProposalError, create_proposal


def _propose(team_id, kind, payload, invoked_by, summary="Hermes proposal"):
    db = SessionLocal()
    try:
        proposal = create_proposal(db, db.get(Team, team_id), kind, payload, summary=summary, invoked_by=invoked_by)
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


def _split(members, points=2):
    return {"tasks": [{"title": f"Task for {m}", "assignee_id": m, "estimate_points": points, "rationale": "Builds on their roadmap"} for m in members]}


def test_balanced_split_becomes_a_team_proposal_with_a_chat_card(client):
    world = make_world(students=4, team_members=3)
    members = world["students"][:3]
    proposal_id = _propose(world["team_id"], "task_split", _split(members), members[0], summary="Split the SRS work")
    proposal = _proposal(proposal_id)
    assert (proposal.scope, proposal.status, proposal.affected_user_id) == ("team", "pending", None)
    events = events_for(world["team_id"])
    assert [event["type"] for event in events[-2:]] == ["proposal.created", "message.created"]
    card = events[-1]["payload"]
    assert (card["kind"], card["metadata"], card["author_user_id"]) == ("proposal", {"proposal_id": proposal_id}, None)


def test_unbalanced_split_is_proposed_with_a_warning_instead_of_rejected(client):
    world = make_world(students=4, team_members=3)
    m = world["students"][:3]
    proposal_id = _propose(world["team_id"], "task_split", {"tasks": [
        {"title": "Most of it", "assignee_id": m[0], "estimate_points": 8, "rationale": "r"},
        {"title": "b", "assignee_id": m[1], "estimate_points": 1, "rationale": "r"},
        {"title": "c", "assignee_id": m[2], "estimate_points": 1, "rationale": "r"},
    ]}, m[0])
    card = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(m[0])).json()["proposals"][0]
    assert card["id"] == proposal_id and card["status"] == "pending"
    assert len(card["warnings"]) == 1 and card["warnings"][0].startswith("Uneven workload")
    # The simulation behind the warning left nothing on the board.
    assert client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(m[0])).json()["tasks"] == []


def test_balanced_split_has_no_warnings(client):
    world = make_world(students=4, team_members=3)
    proposal_id = _propose(world["team_id"], "task_split", _split(world["students"][:3]), world["students"][0])
    assert client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(world["students"][0])).json()["proposals"][0]["warnings"] == []
    assert _proposal(proposal_id).decided_via is None


@pytest.mark.parametrize(("payload_for", "reason"), [
    (lambda m, o: _split(m[:2]), "Every member"),
    (lambda m, o: _split([*m, o]), "not a member"),
    (lambda m, o: {"tasks": [{"title": "x", "assignee_id": m[0], "estimate_points": 2}]}, "Invalid task_split"),
])
def test_bad_splits_are_rejected_with_a_reason(client, payload_for, reason):
    world = make_world(students=4, team_members=3)
    before = len(events_for(world["team_id"]))
    with pytest.raises(ProposalError, match=reason):
        _propose(world["team_id"], "task_split", payload_for(world["students"][:3], world["outsider"]), world["students"][0])
    assert len(events_for(world["team_id"])) == before


def test_majority_vote_applies_the_split_as_hermes_tasks(client):
    world = make_world(students=4, team_members=3)
    s0, s1, s2 = world["students"][:3]
    proposal_id = _propose(world["team_id"], "task_split", _split([s0, s1, s2]), s0)
    first = client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(s0))
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "pending"
    assert client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(s1)).json()["status"] == "applied"
    state = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(s2)).json()
    created = [task for task in state["tasks"] if task["created_by"] == "hermes"]
    assert {task["assignee_id"] for task in created} == {s0, s1, s2}
    assert all(task["rationale"] for task in created)
    assert state["proposals"][0]["status"] == "applied"


def test_vote_is_rejected_once_a_majority_is_impossible(client):
    world = make_world(students=4, team_members=3)
    s0, s1, s2 = world["students"][:3]
    proposal_id = _propose(world["team_id"], "task_split", _split([s0, s1, s2]), s0)
    assert client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "down"}, headers=hdr(s0)).json()["status"] == "pending"
    assert client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "down"}, headers=hdr(s1)).json()["status"] == "rejected"
    before = len(events_for(world["team_id"]))
    assert client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(s2)).status_code == 409
    assert len(events_for(world["team_id"])) == before
    assert client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(world["instructor"])).status_code == 403


def test_personal_edit_goes_to_the_assignee_and_goes_stale_if_work_starts(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    task = client.post(f"/api/teams/{team}/tasks", json={"title": "ERD", "assignee_id": s1}, headers=hdr(s0)).json()
    proposal_id = _propose(team, "task_edit", {"task_id": task["id"], "changes": {"description": "Include all entities"}, "rationale": "clearer"}, s0)
    proposal = _proposal(proposal_id)
    assert (proposal.scope, proposal.affected_user_id) == ("personal", s1)
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(world["students"][2])).status_code == 403
    client.post(f"/api/tasks/{task['id']}/move", json={"status": "doing"}, headers=hdr(s1))
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).json()["status"] == "stale"
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s1)).json()
    assert next(item for item in state["tasks"] if item["id"] == task["id"])["description"] == ""
    with pytest.raises(ProposalError, match="only to-do"):
        _propose(team, "task_edit", {"task_id": task["id"], "changes": {"title": "x"}}, s0)


def test_stalled_team_vote_waits_for_the_lead(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    proposal_id = _propose(team, "milestones", {"milestones": [{"title": "Prototype demo"}]}, s0)
    db = SessionLocal()
    try:
        db.get(TeamProposal, proposal_id).expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    finally:
        db.close()
    state = client.get(f"/api/teams/{team}/state", headers=hdr(s1)).json()
    assert next(item for item in state["proposals"] if item["id"] == proposal_id)["status"] == "awaiting_lead"
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).status_code == 403
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s0)).json()["status"] == "applied"
    titles = [item["title"] for item in client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["milestones"]]
    assert "Prototype demo" in titles


def test_section_draft_goes_to_its_owner(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    document = client.post(f"/api/teams/{team}/documents", json={"kind": "srs"}, headers=hdr(s0)).json()
    section = next(item for item in document["sections"] if item["key"] == "3.2")
    client.patch(f"/api/sections/{section['id']}", json={"owner_user_id": s1}, headers=hdr(s0))
    proposal_id = _propose(team, "doc_section", {"section_id": section["id"], "content_md": "FR-1 The system shall list items.", "requirement_ids": ["FR-1"]}, s0)
    assert _proposal(proposal_id).affected_user_id == s1
    assert client.post(f"/api/proposals/{proposal_id}/accept", headers=hdr(s1)).json()["status"] == "applied"
    sections = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["documents"][0]["sections"]
    saved = next(item for item in sections if item["key"] == "3.2")
    assert (saved["content_md"], saved["status"], saved["meta"]["requirement_ids"]) == ("FR-1 The system shall list items.", "accepted", ["FR-1"])


def test_instructors_see_proposals_but_cannot_decide(client):
    world = make_world()
    proposal_id = _propose(world["team_id"], "charter", {"charter": {"goal": "Ship it"}}, world["students"][0])
    state = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(world["instructor"])).json()
    assert [item["id"] for item in state["proposals"]] == [proposal_id]
    assert client.post(f"/api/proposals/{proposal_id}/reject", headers=hdr(world["instructor"])).status_code == 403
