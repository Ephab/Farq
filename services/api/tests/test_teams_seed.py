import json

from sqlalchemy import func, select

from team_world import client, hdr  # noqa: F401

from app.database import SessionLocal
from app.schemas import ProjectBrief
from app.teams.models import Assignment, Team, TeamMessage
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
    assert len(state["messages"]) == 16
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
