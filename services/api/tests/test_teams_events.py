import re

import pytest

from team_world import client, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams import events
from app.teams.events import emit


@pytest.fixture(autouse=True)
def one_poll(monkeypatch):
    monkeypatch.setattr(events, "MAX_POLLS", 1)
    monkeypatch.setattr(events, "POLL_SECONDS", 0)


def _emit(team_id, type_, actor, payload, visible_to=None) -> int:
    db = SessionLocal()
    try:
        event = emit(db, team_id, type_, actor, payload, visible_to_user_id=visible_to)
        db.commit()
        return event.seq
    finally:
        db.close()


def _stream(client, team_id, user_id, headers=None, **params):
    query = {"as": user_id, **params} if user_id else params
    return client.get(f"/api/teams/{team_id}/events", params=query, headers=headers or {})


def _seqs(text: str) -> list[int]:
    return [int(value) for value in re.findall(r"^id: (\d+)$", text, re.M)]


def test_member_sees_team_and_own_private_events(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    task = _emit(team, "task.created", s0, {"id": "t1"})
    message = _emit(team, "message.created", s0, {"id": "m1"})
    _emit(team, "notice.created", None, {"text": "for s1"}, visible_to=s1)
    mine = _emit(team, "notice.created", None, {"text": "for s0"}, visible_to=s0)
    response = _stream(client, team, s0)
    assert response.status_code == 200, response.text
    assert _seqs(response.text) == [task, message, mine]
    assert '"payload": {"id": "t1"}' in response.text


def test_instructor_never_receives_chat_or_private_events(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    task = _emit(team, "task.created", s0, {"id": "t1"})
    _emit(team, "message.created", s0, {"id": "m1"})
    _emit(team, "reaction.toggled", s0, {"message_id": "m1"})
    _emit(team, "notice.created", None, {"text": "private"}, visible_to=s0)
    decision = _emit(team, "decision.pinned", s0, {"text": "Use FastAPI"})
    assert _seqs(_stream(client, team, world["instructor"]).text) == [task, decision]


def test_stream_resumes_after_last_event_id(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    first, second, third = (_emit(team, "task.created", s0, {"n": n}) for n in range(3))
    assert _seqs(_stream(client, team, s0, headers={"Last-Event-ID": str(first)}).text) == [second, third]
    assert _seqs(_stream(client, team, s0, after=second).text) == [third]


def test_stream_requires_a_known_viewer_with_access(client):
    world = make_world()
    team = world["team_id"]
    assert _stream(client, team, None).status_code == 401
    assert _stream(client, team, world["outsider"]).status_code == 403
    assert _stream(client, "no-such-team", world["students"][0]).status_code == 404
