from datetime import datetime, timedelta, timezone

import pytest

from team_world import client, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.teams import events
from app.teams.models import Assignment, Task, Team, TeamEvent, TeamMember
from app.teams.notices import assess, post_notices


def _days_ago(days):
    return datetime.now(timezone.utc) - timedelta(days=days)


def _doing_task(client, world, title, days):
    team, s0 = world["team_id"], world["students"][0]
    task = client.post(f"/api/teams/{team}/tasks", json={"title": title, "assignee_id": s0}, headers=hdr(s0)).json()
    client.post(f"/api/tasks/{task['id']}/move", json={"status": "doing"}, headers=hdr(s0))
    db = SessionLocal()
    try:
        for event in db.query(TeamEvent).filter(TeamEvent.team_id == team).all():
            if f'"id": "{task["id"]}"' in event.payload_json:
                event.created_at = _days_ago(days)
        db.get(Task, task["id"]).updated_at = _days_ago(days)
        db.commit()
    finally:
        db.close()
    return task


def _risks(team_id):
    db = SessionLocal()
    try:
        return assess(db, db.get(Team, team_id))
    finally:
        db.close()


def _post(team_id):
    db = SessionLocal()
    try:
        created = post_notices(db, db.get(Team, team_id))
        db.commit()
        return [(message.content, message.visible_to_user_id) for message in created]
    finally:
        db.close()


def test_blocked_doing_task_is_a_team_risk(client):
    world = make_world()
    _doing_task(client, world, "Use cases", 4)
    blocked = [risk for risk in _risks(world["team_id"]) if risk.kind == "blocked"]
    assert len(blocked) == 1
    assert "Use cases" in blocked[0].text and "4 days" in blocked[0].text
    assert blocked[0].user_id is None


def test_deadline_risk_without_progress_near_the_deadline(client):
    world = make_world()
    db = SessionLocal()
    try:
        db.get(Assignment, world["assignment_id"]).deadline = datetime.now(timezone.utc) + timedelta(days=5)
        db.commit()
    finally:
        db.close()
    client.post(f"/api/teams/{world['team_id']}/tasks", json={"title": "Report", "estimate_points": 3}, headers=hdr(world["students"][0]))
    deadline = [risk for risk in _risks(world["team_id"]) if risk.kind == "deadline"]
    assert len(deadline) == 1
    assert "no tasks were finished" in deadline[0].text


def test_quiet_member_notice_is_private(client):
    world = make_world()
    quiet = world["students"][2]
    db = SessionLocal()
    try:
        db.query(TeamMember).filter(TeamMember.team_id == world["team_id"], TeamMember.user_id == quiet).one().joined_at = _days_ago(10)
        db.commit()
    finally:
        db.close()
    posted = _post(world["team_id"])
    assert [visible for _content, visible in posted] == [quiet]
    others = client.get(f"/api/teams/{world['team_id']}/state", headers=hdr(world["students"][0])).json()["messages"]
    assert not any(message["kind"] == "notice" for message in others)


def test_notices_are_deduped_and_capped_per_day(client):
    world = make_world()
    for index in range(4):
        _doing_task(client, world, f"Task {index}", 5)
    assert len(_post(world["team_id"])) == 3
    assert _post(world["team_id"]) == []


def test_stream_connect_posts_notices_and_instructors_see_team_risks_only(client, monkeypatch):
    monkeypatch.setattr(events, "MAX_POLLS", 1)
    monkeypatch.setattr(events, "POLL_SECONDS", 0)
    world = make_world()
    team, s0 = world["team_id"], world["students"][0]
    _doing_task(client, world, "Wireframes", 4)
    db = SessionLocal()
    try:
        db.query(TeamMember).filter(TeamMember.team_id == team, TeamMember.user_id == world["students"][2]).one().joined_at = _days_ago(10)
        db.commit()
    finally:
        db.close()
    client.get(f"/api/teams/{team}/events", params={"as": s0})
    client.get(f"/api/teams/{team}/events", params={"as": s0})
    notices = [m for m in client.get(f"/api/teams/{team}/state", headers=hdr(s0)).json()["messages"] if m["kind"] == "notice"]
    assert [m["content"] for m in notices].count(notices[0]["content"]) == 1
    assert "Wireframes" in notices[0]["content"]
    kinds = [risk["kind"] for risk in client.get(f"/api/teams/{team}/risks", headers=hdr(world["instructor"])).json()]
    assert "blocked" in kinds and "quiet" not in kinds
    card = next(item for item in client.get("/api/me/teams-home", headers=hdr(s0)).json()["teams"] if item["id"] == team)
    assert "Wireframes" in card["risk"]
