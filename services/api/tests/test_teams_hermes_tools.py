from team_world import client, hdr, make_world  # noqa: F401

from app.database import SessionLocal
from app.models import StudentFact

INTERNAL = {"X-Farq-Internal-Token": "farq-internal-dev"}


def _context(client, team_id, user_id):
    return client.get(f"/internal/hermes/teams/{team_id}/context", params={"acting_user_id": user_id}, headers=INTERNAL)


def test_member_context_has_cards_tasks_and_recent_chat(client):
    world = make_world()
    team, s0, s1 = world["team_id"], world["students"][0], world["students"][1]
    db = SessionLocal()
    try:
        db.add(StudentFact(student_id=s1, category="skill", key="Python", value_json='"Python"', source_kind="chat"))
        db.add(StudentFact(student_id=s1, category="weakness", key="Deadlines", value_json='"Deadlines"', source_kind="chat"))
        db.commit()
    finally:
        db.close()
    client.post(f"/api/teams/{team}/messages", json={"content": "Hello team"}, headers=hdr(s1))
    client.post(f"/api/teams/{team}/tasks", json={"title": "ERD", "assignee_id": s1}, headers=hdr(s0))
    context = _context(client, team, s0).json()
    card = next(item for item in context["teammates"] if item["user_id"] == s1)
    assert card["facts"] == [{"category": "skill", "key": "Python", "value": "Python"}]
    assert card["roadmap"] is None
    assert [item["content"] for item in context["messages"]] == ["Hello team"]
    assert [item["title"] for item in context["tasks"]] == ["ERD"]
    assert context["acting_user"]["role"] == "lead"


def test_instructor_context_never_contains_chat(client):
    world = make_world()
    client.post(f"/api/teams/{world['team_id']}/messages", json={"content": "Secret plan"}, headers=hdr(world["students"][0]))
    context = _context(client, world["team_id"], world["instructor"]).json()
    assert "messages" not in context
    assert "Secret plan" not in str(context)
    assert len(context["teammates"]) == 3


def test_internal_endpoints_require_token_and_access(client):
    world = make_world()
    team = world["team_id"]
    task = client.post(f"/api/teams/{team}/tasks", json={"title": "ERD"}, headers=hdr(world["students"][0])).json()
    assert client.get(f"/internal/hermes/teams/{team}/context", params={"acting_user_id": world["students"][0]}).status_code == 401
    assert _context(client, team, world["outsider"]).status_code == 403
    assert _context(client, team, "nobody").status_code == 404
    assert client.get(f"/internal/hermes/tasks/{task['id']}", params={"acting_user_id": world["outsider"]}, headers=INTERNAL).status_code == 403
    assert client.get(f"/internal/hermes/tasks/{task['id']}", params={"acting_user_id": world["students"][1]}, headers=INTERNAL).json()["title"] == "ERD"


def test_propose_via_internal_endpoint_explains_rejections(client):
    world = make_world()
    team, members = world["team_id"], world["students"][:3]
    url = f"/internal/hermes/teams/{team}/proposals"
    lopsided = {"tasks": [{"title": "All of it", "assignee_id": members[0], "estimate_points": 3, "rationale": "r"}]}
    rejected = client.post(url, json={"acting_user_id": members[0], "kind": "task_split", "payload": lopsided, "summary": "Split"}, headers=INTERNAL)
    assert rejected.status_code == 422
    assert "Every member" in rejected.json()["detail"]
    fair = {"tasks": [{"title": f"Part {n}", "assignee_id": m, "estimate_points": 2, "rationale": "r"} for n, m in enumerate(members)]}
    created = client.post(url, json={"acting_user_id": members[0], "kind": "task_split", "payload": fair, "summary": "Split"}, headers=INTERNAL)
    assert created.status_code == 201, created.text
    assert created.json()["proposal"]["status"] == "pending"
    assert client.post(url, json={"acting_user_id": world["instructor"], "kind": "task_split", "payload": fair, "summary": "x"}, headers=INTERNAL).status_code == 403


def test_seeded_teammates_have_roadmap_stages(client):
    context = _context(client, "team-falcon", "demo-student").json()
    sara = next(item for item in context["teammates"] if item["user_id"] == "demo-sara")
    assert sara["roadmap"]["current_stage"] == "Computer vision"
    assert "Data modelling for ML apps" in sara["roadmap"]["open_nodes"]
    assert {fact["category"] for fact in sara["facts"]} >= {"skill", "goal"}
