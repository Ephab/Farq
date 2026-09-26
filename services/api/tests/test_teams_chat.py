from team_world import client, events_for, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams.events import events_after


def _post(client, team_id, user_id, **body):
    return client.post(f"/api/teams/{team_id}/messages", json=body, headers=hdr(user_id))


def test_posting_keeps_arabic_text_and_emits_one_event(client):
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    before = len(events_for(team))
    text = "هل يمكن لأحد تقسيم متطلبات SRS؟ 🙏"
    response = _post(client, team, s0, content=text)
    assert response.status_code == 201, response.text
    assert response.json()["content"] == text
    new = events_for(team)[before:]
    assert [event["type"] for event in new] == ["message.created"]
    assert new[0]["payload"]["content"] == text


def test_rejected_messages_emit_nothing(client):
    world = make_world()
    team = world["team_id"]
    before = len(events_for(team))
    assert _post(client, team, world["students"][0], content="   ").status_code == 422
    assert _post(client, team, world["instructor"], content="Hello team").status_code == 403
    assert _post(client, team, world["outsider"], content="Hello team").status_code == 403
    assert _post(client, team, world["students"][0], content="Poll?", poll_options=["Only one"]).status_code == 422
    assert len(events_for(team)) == before


def test_polls_and_reactions(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    poll = _post(client, team, s0, content="When do we meet?", poll_options=["Sun 8pm", "Tue 8pm"]).json()
    assert poll["kind"] == "poll"
    voted = client.post(f"/api/messages/{poll['id']}/poll-vote", json={"option": 1}, headers=hdr(s1))
    assert voted.status_code == 200, voted.text
    assert voted.json()["metadata"]["votes"] == {s1: 1}
    assert client.post(f"/api/messages/{poll['id']}/poll-vote", json={"option": 5}, headers=hdr(s1)).status_code == 422
    text = _post(client, team, s0, content="Plain message").json()
    assert client.post(f"/api/messages/{text['id']}/poll-vote", json={"option": 0}, headers=hdr(s1)).status_code == 409
    first = client.post(f"/api/messages/{text['id']}/reactions", json={"emoji": "👍"}, headers=hdr(s1)).json()
    second = client.post(f"/api/messages/{text['id']}/reactions", json={"emoji": "👍"}, headers=hdr(s1)).json()
    assert (first["on"], second["on"]) == (True, False)


def test_only_the_author_edits_or_deletes(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    message = _post(client, team, s0, content="Draft plan").json()
    assert client.patch(f"/api/messages/{message['id']}", json={"content": "Hacked"}, headers=hdr(s1)).status_code == 403
    edited = client.patch(f"/api/messages/{message['id']}", json={"content": "Final plan"}, headers=hdr(s0))
    assert edited.status_code == 200
    assert edited.json()["edited_at"] is not None
    assert client.delete(f"/api/messages/{message['id']}", headers=hdr(s1)).status_code == 403
    assert client.delete(f"/api/messages/{message['id']}", headers=hdr(s0)).status_code == 200
    assert events_for(team)[-1]["type"] == "message.deleted"
    assert client.patch(f"/api/messages/{message['id']}", json={"content": "Back"}, headers=hdr(s0)).status_code == 403


def test_pinned_decisions_reach_the_instructor_but_the_message_does_not(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    message = _post(client, team, s0, content="We'll deploy on Render").json()
    decision = client.post(f"/api/teams/{team}/decisions", json={"message_id": message["id"]}, headers=hdr(s1))
    assert decision.status_code == 201, decision.text
    assert decision.json()["text"] == "We'll deploy on Render"
    db = SessionLocal()
    try:
        rows, _ = events_after(db, team, 0, world["instructor"], "instructor")
    finally:
        db.close()
    types = [row.type for row in rows]
    assert "decision.pinned" in types
    assert "message.created" not in types


def test_seen_pointer_only_moves_forward(client):
    world = make_world()
    url = f"/api/teams/{world['team_id']}/seen"
    s0 = world["students"][0]
    assert client.post(url, json={"seq": 10}, headers=hdr(s0)).json()["last_seen_seq"] == 10
    assert client.post(url, json={"seq": 3}, headers=hdr(s0)).json()["last_seen_seq"] == 10
