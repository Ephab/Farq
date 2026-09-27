from datetime import timedelta

import pytest

from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.hermes import RunFailed
from app.teams import hermes_team
from app.teams.events import events_after
from app.teams.hermes_team import drain, parse_invocation
from app.teams.models import TeamAgentRun


class FakeHermes:
    def __init__(self):
        self.calls = []
        self.replies = ["On it."]
        self.error = None

    def __call__(self, client, headers, payload, provider, model, timeout_seconds, on_state=None, hermes_api_key=None):
        self.calls.append({"headers": headers, "payload": payload})
        if on_state:
            on_state("running", "fake-model")
        if self.error:
            raise self.error
        return self.replies[min(len(self.calls), len(self.replies)) - 1], "fake-model", "gemini"


@pytest.fixture()
def hermes(monkeypatch):
    fake = FakeHermes()
    monkeypatch.setattr(hermes_team, "execute_with_fallback", fake)
    monkeypatch.setattr(hermes_team, "effective_hermes_key", lambda override: "k" * 32)
    return fake


def _send(client, team, user, content):
    response = client.post(f"/api/teams/{team}/messages", json={"content": content}, headers=hdr(user))
    assert response.status_code == 201, response.text
    return response.json()


def _messages(client, team, user):
    return client.get(f"/api/teams/{team}/state", headers=hdr(user)).json()["messages"]


def test_parse_invocation():
    assert parse_invocation("/split") == ("split", "")
    assert parse_invocation("/draft srs 3.2") == ("draft", "srs 3.2")
    assert parse_invocation("hey @Hermes what's next?") == ("mention", "hey @Hermes what's next?")
    assert parse_invocation("email me@hermes.com") is None
    assert parse_invocation("/poll a | b | c") is None
    assert parse_invocation("just chatting") is None


def test_mention_runs_hermes_on_the_team_session_and_posts_its_reply(client, hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    hermes.replies = ["Ali should take the login API."]
    _send(client, team, s0, "@Hermes who should take login?")
    call = hermes.calls[-1]
    assert call["headers"]["X-Hermes-Session-Key"] == f"waypoint:team:{team}"
    assert f"team_id={team}" in call["payload"]["input"]
    assert f"acting_user_id={s0}" in call["payload"]["input"]
    assert "waypoint-team-coach" in call["payload"]["instructions"]
    last = _messages(client, team, s0)[-1]
    assert (last["author_user_id"], last["content"], last["visible_to_user_id"]) == (None, "Ali should take the login API.", None)
    statuses = [event["payload"]["status"] for event in events_for(team) if event["type"] == "hermes.run"]
    assert statuses[0] == "queued" and "running" in statuses and statuses[-1] == "completed"


def test_plain_messages_and_polls_do_not_wake_hermes(client, hermes):
    world = make_world()
    _send(client, world["team_id"], world["students"][0], "hello team")
    client.post(f"/api/teams/{world['team_id']}/messages", json={"content": "When?", "poll_options": ["Sun", "Tue"]}, headers=hdr(world["students"][0]))
    assert hermes.calls == []


def test_catchup_is_private_and_starts_after_the_previous_catchup(client, hermes):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    _send(client, team, s1, "Moved the ERD to review")
    hermes.replies = ["First digest.", "Second digest."]
    _send(client, team, s0, "/catchup")
    assert "Moved the ERD to review" in hermes.calls[-1]["payload"]["input"]
    _send(client, team, s1, "Second update")
    _send(client, team, s0, "/catchup")
    second = hermes.calls[-1]["payload"]["input"]
    assert "Second update" in second and "Moved the ERD to review" not in second
    mine = [m for m in _messages(client, team, s0) if m["author_user_id"] is None]
    assert [m["content"] for m in mine] == ["First digest.", "Second digest."]
    assert all(m["visible_to_user_id"] == s0 for m in mine)
    assert not any(m["content"] == "First digest." for m in _messages(client, team, s1))


def test_failed_run_tells_only_the_invoker(client, hermes):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    hermes.error = RunFailed("All 3 models tried failed")
    _send(client, team, s0, "@Hermes help")
    last = _messages(client, team, s0)[-1]
    assert (last["kind"], last["visible_to_user_id"]) == ("system", s0)
    assert "couldn't finish" in last["content"]
    assert not any("couldn't finish" in m["content"] for m in _messages(client, team, s1))
    db = SessionLocal()
    try:
        assert db.query(TeamAgentRun).filter(TeamAgentRun.team_id == team).one().status == "failed"
    finally:
        db.close()


def test_instructor_stream_never_sees_hermes_activity(client, hermes):
    world = make_world()
    _send(client, world["team_id"], world["students"][0], "@Hermes status?")
    db = SessionLocal()
    try:
        rows, _ = events_after(db, world["team_id"], 0, world["instructor"], "instructor")
    finally:
        db.close()
    assert not [row.type for row in rows if row.type.startswith(("hermes.", "message."))]


def test_draft_creates_the_document_and_names_the_section(client, hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    _send(client, team, s0, "/draft srs 3.2")
    documents = client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["documents"]
    section = next(item for item in documents[0]["sections"] if item["key"] == "3.2")
    prompt = hermes.calls[-1]["payload"]["input"]
    assert f"section_id={section['id']}" in prompt and "SRS 3.2" in prompt


def test_bad_draft_arguments_fail_with_a_hint(client, hermes):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    _send(client, team, s0, "/draft thesis 1")
    last = _messages(client, team, s0)[-1]
    assert (last["kind"], last["visible_to_user_id"]) == ("system", s0)
    assert "/draft srs" in last["content"]
    assert hermes.calls == []


def test_drain_runs_one_at_a_time_in_order(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    db = SessionLocal()
    try:
        first = TeamAgentRun(team_id=team, invoked_by_user_id=s0, trigger_message_id="m1", command="mention")
        db.add(first)
        db.flush()
        second = TeamAgentRun(team_id=team, invoked_by_user_id=s0, trigger_message_id="m2", command="mention",
                              created_at=first.created_at + timedelta(seconds=1))
        db.add(second)
        db.commit()
        ids = [first.id, second.id]
    finally:
        db.close()
    order = []

    def runner(run_id):
        order.append(run_id)
        session = SessionLocal()
        try:
            session.get(TeamAgentRun, run_id).status = "completed"
            session.commit()
        finally:
            session.close()

    lock = hermes_team._lock_for(team)
    lock.acquire()
    drain(team, runner)
    assert order == []
    lock.release()
    drain(team, runner)
    assert order == ids
