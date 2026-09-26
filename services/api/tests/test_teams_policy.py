import pytest
from fastapi import HTTPException

from team_world import client, make_world  # noqa: F401

from app.database import SessionLocal
from app.identity import User
from app.teams.models import Team
from app.teams.policy import authorize

CASES = [
    ("lead", "view", True), ("lead", "view_chat", True), ("lead", "write", True), ("lead", "lead", True),
    ("member", "view", True), ("member", "view_chat", True), ("member", "write", True), ("member", "lead", False),
    ("instructor", "view", True), ("instructor", "view_chat", False), ("instructor", "write", False), ("instructor", "lead", False),
    ("classmate", "view", False), ("outsider", "view", False),
]


@pytest.mark.parametrize(("who", "action", "allowed"), CASES)
def test_permission_table(client, who, action, allowed):
    world = make_world(students=4, team_members=2)
    user_id = {
        "lead": world["students"][0], "member": world["students"][1], "classmate": world["students"][2],
        "instructor": world["instructor"], "outsider": world["outsider"],
    }[who]
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        team = db.get(Team, world["team_id"])
        if allowed:
            assert authorize(db, user, team, action) in {"lead", "member", "instructor"}
        else:
            with pytest.raises(HTTPException) as error:
                authorize(db, user, team, action)
            assert error.value.status_code == 403
    finally:
        db.close()


def test_instructor_of_another_course_is_an_outsider(client):
    mine, other = make_world(), make_world()
    db = SessionLocal()
    try:
        with pytest.raises(HTTPException) as error:
            authorize(db, db.get(User, other["instructor"]), db.get(Team, mine["team_id"]), "view")
        assert error.value.status_code == 403
    finally:
        db.close()
