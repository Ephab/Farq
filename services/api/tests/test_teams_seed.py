import json

from sqlalchemy import func, select, update

from team_world import client, hdr  # noqa: F401

from app.database import SessionLocal
from app.schemas import ProjectBrief
from app.teams.models import Assignment, Team, TeamAgentRun, TeamMessage
from app.teams.seed import seed_teams


def test_seed_creates_the_falcon_demo(client):
    home = client.get("/api/me/teams-home", headers=hdr("demo-student")).json()
    falcon = next(card for card in home["teams"] if card["id"] == "team-falcon")
    assert falcon["viewer_role"] == "lead"
    assert falcon["progress"] == 21
    assert falcon["unread"] == 3
    assert "asg-cs485-project" in [item["assignment_id"] for item in home["needs_team"]]
    state = client.get("/api/teams/team-falcon/state", headers=hdr("demo-student")).json()
    assert len(state["tasks"]) == 6
    assert {task["status"] for task in state["tasks"]} == {"todo", "doing", "done"}
    messages = state["messages"]
    assert len(messages) == 22
    polls = [message for message in messages if message["kind"] == "poll"]
    assert len(polls) == 2 and polls[0]["metadata"]["votes"] == {"demo-student": 0, "demo-sara": 0, "demo-ali": 0, "demo-noura": 1}
    assert sum(message["reply_to_id"] is not None for message in messages) == 5
    assert any(message["reactions"] for message in messages)
    assert any(message["content"] == "/standup" for message in messages)
    assert state["documents"][0]["kind"] == "srs"
    assert sum(section["status"] == "accepted" for section in state["documents"][0]["sections"]) == 2
    assert len(state["decisions"]) == 1
    instructor = client.get("/api/teams/team-falcon/state", headers=hdr("demo-instructor")).json()
    assert instructor["messages"] is None


def test_seed_is_idempotent(client):
    db = SessionLocal()
    try:
        before = db.scalar(select(func.count()).select_from(TeamMessage))
        seed_teams(db)
        seed_teams(db)
        assert db.scalar(select(func.count()).select_from(Team).where(Team.id == "team-falcon")) == 1
        assert db.scalar(select(func.count()).select_from(TeamMessage)) == before
    finally:
        db.close()


def test_seed_brief_is_a_valid_project_brief(client):
    db = SessionLocal()
    try:
        for assignment_id in ("asg-swe363-term", "asg-cs485-project"):
            ProjectBrief.model_validate(json.loads(db.get(Assignment, assignment_id).brief_json))
    finally:
        db.close()


def test_demo_users_include_the_instructor_switch_target(client):
    ids = {user["id"] for user in client.get("/api/demo/users").json()}
    assert {"demo-student", "demo-sara", "demo-instructor"} <= ids


def test_reset_team_rebuilds_group_1_from_the_seed(client):
    state = client.get("/api/teams/team-falcon/state", headers=hdr("demo-student")).json()
    client.post("/api/teams/team-falcon/messages", json={"content": "scratch"}, headers=hdr("demo-student"))
    client.patch("/api/teams/team-falcon", json={"name": "Renamed"}, headers=hdr("demo-student"))
    assert client.post("/api/demo/reset-team", json={"confirm": "nope"}).status_code == 422
    db = SessionLocal()
    try:
        db.add(TeamAgentRun(team_id="team-falcon", invoked_by_user_id="demo-student", trigger_message_id="m", command="mention", status="running"))
        db.commit()
        assert client.post("/api/demo/reset-team", json={"confirm": "RESET"}).status_code == 409
        db.execute(update(TeamAgentRun).where(TeamAgentRun.team_id == "team-falcon").values(status="completed"))
        db.commit()
    finally:
        db.close()
    assert client.post("/api/demo/reset-team", json={"confirm": "RESET"}).status_code == 200
    after = client.get("/api/teams/team-falcon/state", headers=hdr("demo-student")).json()
    assert after["team"]["name"] == "Group 1"
    assert len(after["messages"]) == len(state["messages"]) == 22
    assert "scratch" not in [message["content"] for message in after["messages"]]
    assert len(after["decisions"]) == 1
