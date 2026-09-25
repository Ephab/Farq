import json
import re

import pytest

from team_world import client, hdr, make_world  # noqa: F401

from app.teams import events, presence


@pytest.fixture(autouse=True)
def one_poll(monkeypatch):
    monkeypatch.setattr(events, "MAX_POLLS", 1)
    monkeypatch.setattr(events, "POLL_SECONDS", 0)


def _presence(text: str) -> list[dict]:
    match = re.search(r"^event: presence\ndata: (.+)$", text, re.M)
    assert match, text
    return json.loads(match.group(1))


def test_stream_reports_online_members_and_typing(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    assert client.post(f"/api/teams/{team}/presence", json={"focus": "task:abc"}, headers=hdr(s1)).status_code == 200
    assert client.post(f"/api/teams/{team}/typing", headers=hdr(s1)).status_code == 200
    frame = {entry["user_id"]: entry for entry in _presence(client.get(f"/api/teams/{team}/events", params={"as": s0}).text)}
    assert frame[s1] == {"user_id": s1, "focus": "task:abc", "typing": True}
    assert s0 in frame  # an open stream counts as being online


def test_instructors_get_presence_without_typing_and_are_not_listed(client):
    world = make_world()
    team, s1 = world["team_id"], world["students"][1]
    client.post(f"/api/teams/{team}/typing", headers=hdr(s1))
    frame = {entry["user_id"]: entry for entry in _presence(client.get(f"/api/teams/{team}/events", params={"as": world["instructor"]}).text)}
    assert frame[s1]["typing"] is False
    assert world["instructor"] not in frame
    assert client.post(f"/api/teams/{team}/typing", headers=hdr(world["instructor"])).status_code == 403


def test_presence_expires(client, monkeypatch):
    world = make_world()
    team, s1 = world["team_id"], world["students"][1]
    client.post(f"/api/teams/{team}/presence", json={"focus": None}, headers=hdr(s1))
    base = presence._clock()
    monkeypatch.setattr(presence, "_clock", lambda: base + presence.TTL_SECONDS + 1)
    assert presence.snapshot(team) == []
