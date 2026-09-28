import pytest

from team_world import client, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.models import Team
from app.teams.proposals import ProposalError, create_proposal


def _propose(team_id, kind, payload, invoked_by):
    db = SessionLocal()
    try:
        proposal = create_proposal(db, db.get(Team, team_id), kind, payload, summary="Hermes proposal", invoked_by=invoked_by)
        db.commit()
        return proposal.id
    finally:
        db.close()


def _task(client, team, lead, title, assignee, points=2, **extra):
    return client.post(f"/api/teams/{team}/tasks", json={"title": title, "assignee_id": assignee, "estimate_points": points, **extra}, headers=hdr(lead)).json()


def _vote_through(client, proposal_id, members):
    result = None
    for member in members[:2]:
        result = client.post(f"/api/proposals/{proposal_id}/vote", json={"vote": "up"}, headers=hdr(member)).json()
    return result


def _tasks(client, team, user):
    return {task["id"]: task for task in client.get(f"/api/teams/{team}/state", headers=hdr(user)).json()["tasks"]}


def test_delete_proposal_removes_todo_tasks_and_detaches_dependents(client):
    world = make_world()
    team, members = world["team_id"], world["students"][:3]
    first = _task(client, team, members[0], "Old idea", members[0])
    second = _task(client, team, members[0], "Follow-up", members[1], depends_on=[first["id"]])
    proposal_id = _propose(team, "task_delete", {"task_ids": [first["id"]], "rationale": "Out of scope"}, members[0])
    assert _vote_through(client, proposal_id, members)["status"] == "applied"
    tasks = _tasks(client, team, members[0])
    assert first["id"] not in tasks
    assert tasks[second["id"]]["depends_on"] == []


def test_delete_proposal_refuses_started_work(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    task = _task(client, team, s0, "In progress", s0)
    client.post(f"/api/tasks/{task['id']}/move", json={"status": "doing"}, headers=hdr(s0))
    with pytest.raises(ProposalError, match="only to-do"):
        _propose(team, "task_delete", {"task_ids": [task["id"]], "rationale": "r"}, s0)


def test_reorganize_reassigns_deletes_and_adds_in_one_vote(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    keep = _task(client, team, s0, "Login API", s0, 3)
    move = _task(client, team, s0, "ERD", s0, 2)
    drop = _task(client, team, s0, "Duplicate", s1, 2)
    payload = {
        "changes": [{"task_id": move["id"], "assignee_id": s2}],
        "deletes": [drop["id"]],
        "adds": [{"title": "Wireframes", "assignee_id": s1, "estimate_points": 2, "rationale": "Stretch for design"}],
        "rationale": "Rebalance after the scope change",
    }
    proposal_id = _propose(team, "task_reorganize", payload, s0)
    assert _vote_through(client, proposal_id, [s0, s1, s2])["status"] == "applied"
    tasks = _tasks(client, team, s0)
    assert tasks[move["id"]]["assignee_id"] == s2
    assert tasks[move["id"]]["title"] == "ERD"
    assert tasks[keep["id"]]["assignee_id"] == s0
    assert drop["id"] not in tasks
    added = [task for task in tasks.values() if task["title"] == "Wireframes"]
    assert len(added) == 1 and added[0]["created_by"] == "hermes" and added[0]["assignee_id"] == s1


def test_unbalanced_reorganize_is_flagged_not_blocked(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    tasks = [_task(client, team, s0, f"T{n}", member, 2) for n, member in enumerate((s0, s1, s2))]
    everything_to_s0 = {"changes": [{"task_id": tasks[1]["id"], "assignee_id": s0}, {"task_id": tasks[2]["id"], "assignee_id": s0}], "rationale": "r"}
    proposal_id = _propose(team, "task_reorganize", everything_to_s0, s0)
    card = next(item for item in client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["proposals"] if item["id"] == proposal_id)
    assert card["warnings"] and card["warnings"][0].startswith("Uneven workload")
    # Simulating it did not move anything.
    assert _tasks(client, team, s0)[tasks[1]["id"]]["assignee_id"] == s1


def test_reorganize_goes_stale_if_a_task_starts_during_the_vote(client):
    world = make_world()
    team, (s0, s1, s2) = world["team_id"], world["students"][:3]
    tasks = [_task(client, team, s0, f"T{n}", member, 2) for n, member in enumerate((s0, s1, s2))]
    proposal_id = _propose(team, "task_reorganize", {"changes": [{"task_id": tasks[1]["id"], "title": "Renamed"}], "rationale": "clearer"}, s0)
    client.post(f"/api/tasks/{tasks[1]['id']}/move", json={"status": "doing"}, headers=hdr(s1))
    assert _vote_through(client, proposal_id, [s0, s1, s2])["status"] == "stale"
    assert _tasks(client, team, s0)[tasks[1]["id"]]["title"] == "T1"
