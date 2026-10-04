"""Settings > Memory, Skills and Connectors, and how coach runs talk to the gateway."""
import os
import sys
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ChatMessage, ChatThread, StudentMemory, now  # noqa: E402

from conftest import issue_test_grant  # noqa: E402

INTERNAL = {"X-Waypoint-Internal-Token": os.environ["WAYPOINT_INTERNAL_TOKEN"]}


@pytest.fixture(scope="module")
def client():
    with TestClient(app, base_url="http://localhost") as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def _student(client: TestClient, name: str = "Memory Student") -> tuple[str, str]:
    created = client.post("/api/students", json={"display_name": f"{name} {uuid.uuid4().hex[:6]}"}).json()
    thread_id = client.get(f"/api/students/{created['student_id']}/profile").json()["thread_id"]
    return created["student_id"], thread_id


def _say(thread_id: str, text: str, role: str = "user", minutes: int = 0, metadata: str | None = None) -> str:
    with SessionLocal() as db:
        message = ChatMessage(thread_id=thread_id, role=role, content=text, metadata_json=metadata,
                              created_at=now() + timedelta(minutes=minutes))
        db.add(message)
        db.commit()
        return message.id


# --- memory ---------------------------------------------------------------------------------------

def test_student_manages_memory_in_settings(client: TestClient):
    student_id, _ = _student(client)
    base = f"/api/students/{student_id}/memory"
    assert client.get(base).json() == {"enabled": True, "limit": 40, "items": []}

    listing = client.post(base, json={"content": "  Prefers   short, worked examples ", "category": "preference"}).json()
    item = listing["items"][0]
    assert (item["content"], item["category"], item["origin"]) == ("Prefers short, worked examples", "preference", "student")
    # The same sentence again does not add a duplicate.
    assert len(client.post(base, json={"content": "prefers short, worked examples"}).json()["items"]) == 1

    edited = client.patch(f"{base}/{item['id']}", json={"content": "Prefers video walkthroughs"}).json()
    assert edited["items"][0]["content"] == "Prefers video walkthroughs"
    assert client.delete(f"{base}/{item['id']}").json()["items"] == []

    client.post(base, json={"content": "Works evenings"})
    client.post(base, json={"content": "Targets a data role"})
    assert client.delete(base).json()["items"] == []


def test_memory_refuses_secrets_and_contact_details(client: TestClient):
    student_id, _ = _student(client)
    base = f"/api/students/{student_id}/memory"
    for content in ("My password: hunter2", "Uses key sk-abcdefghijklmnopqrstu", "Email me at me@example.com"):
        assert client.post(base, json={"content": content}).status_code == 422, content
    assert client.post(base, json={"content": "x" * 301}).status_code == 422


def test_memory_belongs_to_its_student(client: TestClient):
    owner, _ = _student(client)
    other, _ = _student(client, "Other")
    item = client.post(f"/api/students/{owner}/memory", json={"content": "Likes chess"}).json()["items"][0]
    stranger = {"X-Waypoint-User": other}
    assert client.get(f"/api/students/{owner}/memory", headers=stranger).status_code == 403
    assert client.delete(f"/api/students/{other}/memory/{item['id']}").status_code == 404


def test_hermes_remembers_only_with_a_grant_and_a_cited_message(client: TestClient):
    student_id, thread_id = _student(client)
    other_id, other_thread = _student(client, "Other")
    said = _say(thread_id, "I learn best from short videos")
    url = "/internal/hermes/memory"
    body = {"content": "Learns best from short videos", "category": "learning", "source_message_id": said}

    no_scope = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, scopes=("read",))}
    assert client.post(url, json=body, headers=no_scope).status_code == 403

    grant = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, scopes=("read", "memory"))}
    # An assistant message or another student's message is not a source.
    reply = _say(thread_id, "Noted!", role="assistant", minutes=1)
    assert client.post(url, json={**body, "source_message_id": reply}, headers=grant).status_code == 422
    foreign = _say(other_thread, "I learn best from short videos")
    assert client.post(url, json={**body, "source_message_id": foreign}, headers=grant).status_code == 422
    # The student comes from the grant, never from a model-supplied id.
    assert client.post(url, json={**body, "user_id": other_id}, headers=grant).status_code == 403

    stored = client.post(url, json=body, headers=grant)
    assert stored.status_code == 200, stored.text
    memory_id = stored.json()["memory_id"]
    replaced = client.post(url, json={**body, "content": "Learns best from podcasts", "replaces_id": memory_id}, headers=grant)
    assert replaced.json()["memory_id"] == memory_id
    items = client.get(f"/api/students/{student_id}/memory").json()["items"]
    assert [(i["content"], i["origin"]) for i in items] == [("Learns best from podcasts", "hermes")]

    with SessionLocal() as db:
        from app.models import StudentFact
        assert db.query(StudentFact).filter(StudentFact.student_id == student_id).count() == 0

    assert client.post(f"{url}/forget", json={"memory_id": memory_id}, headers=grant).json() == {"success": True}
    assert client.get(f"/api/students/{student_id}/memory").json()["items"] == []


def test_memory_off_blocks_hermes_and_says_so_in_instructions(client: TestClient):
    from app.hermes import instructions_for

    student_id, thread_id = _student(client)
    client.post(f"/api/students/{student_id}/memory", json={"content": "Plays the oud"})
    with SessionLocal() as db:
        text = instructions_for(student_id, db)
        assert "Plays the oud" in text and "--- Skill `waypoint-memory`" in text

    client.put(f"/api/students/{student_id}/memory/settings", json={"enabled": False})
    with SessionLocal() as db:
        text = instructions_for(student_id, db)
    assert "Plays the oud" not in text and "Memory is OFF" in text

    grant = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, scopes=("read", "memory"))}
    said = _say(thread_id, "I like maths")
    response = client.post("/internal/hermes/memory", json={"content": "Likes maths", "source_message_id": said}, headers=grant)
    assert response.status_code == 403


def test_memory_has_a_cap(client: TestClient):
    from app.student_memory import MAX_MEMORIES

    student_id, _ = _student(client)
    with SessionLocal() as db:
        db.add_all(StudentMemory(student_id=student_id, content=f"Fact {i}", category="other", origin="student")
                   for i in range(MAX_MEMORIES))
        db.commit()
    assert client.post(f"/api/students/{student_id}/memory", json={"content": "One too many"}).status_code == 409


# --- connectors -----------------------------------------------------------------------------------

def test_connector_switch_is_enforced_at_the_tool_endpoint(client: TestClient):
    from app.hermes import instructions_for

    student_id, _ = _student(client)
    listing = client.get(f"/api/students/{student_id}/connectors").json()["connectors"]
    assert {c["id"] for c in listing} == {"blackboard", "hackathons", "coop", "outlook", "learning_reddit", "learning_x"}
    assert all(c["enabled"] for c in listing)

    tool = f"/internal/hermes/students/{student_id}/hackathons"
    assert client.get(tool, headers=INTERNAL).status_code == 200

    off = client.put(f"/api/students/{student_id}/connectors/hackathons", json={"enabled": False}).json()
    assert next(c for c in off["connectors"] if c["id"] == "hackathons")["enabled"] is False
    refused = client.get(tool, headers=INTERNAL)
    assert refused.status_code == 403 and "Settings > Connectors" in refused.json()["detail"]
    with SessionLocal() as db:
        assert "waypoint_find_hackathons" in instructions_for(student_id, db)

    client.put(f"/api/students/{student_id}/connectors/hackathons", json={"enabled": True})
    assert client.get(tool, headers=INTERNAL).status_code == 200
    # Coach mail access keeps its own consent flow in Emails.
    assert client.put(f"/api/students/{student_id}/connectors/outlook", json={"enabled": False}).status_code == 422
    assert client.put(f"/api/students/{student_id}/connectors/nope", json={"enabled": False}).status_code == 404


# --- skills ---------------------------------------------------------------------------------------

def _learned_skill(name: str) -> Path:
    from app.hermes_skills import learned_dir

    folder = learned_dir() / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: How to {name}\n---\n# Steps\n1. Do it.\n", encoding="utf-8")
    return folder


def test_skills_listing_and_learned_skill_lifecycle(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app import hermes_skills

    monkeypatch.setattr(hermes_skills, "_gateway_status", lambda: {"reachable": True})
    _learned_skill("plan-a-study-week")
    listing = client.get("/api/hermes/skills").json()
    assert listing["can_edit"] is True and listing["gateway"] == {"reachable": True}
    builtin = {skill["id"]: skill for skill in listing["builtin"]}
    assert set(builtin) == set(hermes_skills.BUILTIN_SKILLS)
    assert "coach" in builtin["waypoint-student-coach"]["actions"]
    learned = next(s for s in listing["learned"] if s["id"] == "plan-a-study-week")
    assert learned["enabled"] and learned["description"] == "How to plan-a-study-week"

    content = client.get("/api/hermes/skills/content", params={"source": "learned", "id": "plan-a-study-week"}).json()
    assert content["content"].startswith("# Steps")
    builtin_body = client.get("/api/hermes/skills/content", params={"source": "builtin", "id": "waypoint-memory"})
    assert builtin_body.status_code == 200 and "waypoint_remember" in builtin_body.json()["content"]
    assert client.get("/api/hermes/skills/content", params={"source": "builtin", "id": "nope"}).status_code == 404

    archived = client.post("/api/hermes/skills/learned/archive", json={"id": "plan-a-study-week"}).json()
    assert next(s for s in archived["learned"] if s["id"] == "plan-a-study-week")["enabled"] is False
    assert (hermes_skills.learned_dir() / ".archive" / "plan-a-study-week" / "SKILL.md").is_file()
    restored = client.post("/api/hermes/skills/learned/restore", json={"id": "plan-a-study-week"}).json()
    assert next(s for s in restored["learned"] if s["id"] == "plan-a-study-week")["enabled"] is True

    assert client.delete("/api/hermes/skills/learned", params={"id": "../../etc"}).status_code == 404
    deleted = client.delete("/api/hermes/skills/learned", params={"id": "plan-a-study-week"}).json()
    assert all(s["id"] != "plan-a-study-week" for s in deleted["learned"])


def test_skill_changes_are_local_only(client: TestClient):
    remote = TestClient(app, base_url="http://waypoint.example")
    assert remote.put("/api/hermes/skills/learning", json={"enabled": False}).status_code == 403
    assert remote.post("/api/hermes/skills/learned/archive", json={"id": "x"}).status_code == 403


def test_learning_switch_writes_the_runtime_config(client: TestClient):
    import yaml

    from app.hermes_skills import hermes_home, learning_note

    config = hermes_home() / "config.yaml"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text(yaml.safe_dump({"model": {"default": "x"}, "skills": {"creation_nudge_interval": 8}}), encoding="utf-8")
    try:
        assert client.put("/api/hermes/skills/learning", json={"enabled": False}).json() == {"enabled": False, "applies_live": True}
        saved = yaml.safe_load(config.read_text(encoding="utf-8"))
        assert saved["skills"]["creation_nudge_interval"] == 0 and saved["model"] == {"default": "x"}
        assert "learning is OFF" in learning_note()
        client.put("/api/hermes/skills/learning", json={"enabled": True})
        assert yaml.safe_load(config.read_text(encoding="utf-8"))["skills"]["creation_nudge_interval"] == 8
    finally:
        config.unlink(missing_ok=True)


def test_with_skills_inlines_the_skill_body():
    from app.hermes_skills import skill_body, with_skills

    text = with_skills("Base.", "waypoint-quiz", "not-a-skill")
    assert text.startswith("Base.") and skill_body("waypoint-quiz") in text
    assert "--- Skill `waypoint-quiz` (already loaded" in text and "not-a-skill" not in text
    # Frontmatter is stripped.
    assert not skill_body("waypoint-quiz").startswith("---")


# --- gateway usage ----------------------------------------------------------------------------------

def test_conversation_history_comes_from_sqlite(client: TestClient):
    from app.hermes import conversation_history

    _, thread_id = _student(client)
    with SessionLocal() as db:
        db.query(ChatMessage).filter(ChatMessage.thread_id == thread_id).delete()
        db.commit()
    _say(thread_id, "Stale reply", role="assistant", minutes=1)  # leading assistant turns are dropped
    _say(thread_id, "First question", minutes=2)
    _say(thread_id, "Same question again after a failed run", minutes=3)
    _say(thread_id, "An answer", role="assistant", minutes=4)
    _say(thread_id, "Research", minutes=5, metadata='{"interaction": {"hermes_prompt": "I choose the research branch"}}')
    _say(thread_id, "Tool trace", role="tool", minutes=6)
    current = _say(thread_id, "Current message", minutes=7)
    _say(thread_id, "A later message", minutes=8)

    with SessionLocal() as db:
        turns = conversation_history(db, thread_id, current)
    assert turns == [
        {"role": "user", "content": "First question\n\nSame question again after a failed run"},
        {"role": "assistant", "content": "An answer"},
        {"role": "user", "content": "I choose the research branch"},
    ]


def test_abandoned_runs_are_stopped_with_the_gateway_stop_route():
    from app.hermes import _cancel_gateway_run, _poll_delay

    calls = []

    class Client:
        def post(self, url, headers=None, json=None):
            calls.append(url)

    _cancel_gateway_run(Client(), "http://hermes", "run-1", {})
    assert calls == ["http://hermes/v1/runs/run-1/stop"]
    assert _poll_delay(0) == 0.25 and _poll_delay(20) == 2


def test_coach_run_sends_history_and_a_fresh_session(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    from app import hermes as hermes_module
    student_id, thread_id = _student(client)
    sent = {}

    def fake_execute(_client, _headers, payload, *args, **kwargs):
        sent.update(payload)
        return "Hello back", "gemini", "gemini-2.5-flash"

    monkeypatch.setattr(hermes_module, "execute_with_fallback", fake_execute)
    monkeypatch.setattr("app.main.run_agent", lambda *args, **kwargs: None)
    _say(thread_id, "Earlier question", minutes=-2)
    _say(thread_id, "Earlier answer", role="assistant", minutes=-1)
    run_id = client.post(f"/api/chat/threads/{thread_id}/messages", json={"content": "Hello Hermes"}).json()["run_id"]
    with SessionLocal() as db:
        session = db.get(ChatThread, thread_id).hermes_session_id
    hermes_module.run_agent(run_id, student_id, hermes_api_key="k" * 64)

    assert sent["session_id"].startswith(session + "-") and sent["session_id"] != session
    assert sent["conversation_history"][-2:] == [
        {"role": "user", "content": "Earlier question"}, {"role": "assistant", "content": "Earlier answer"}]
    assert "--- Skill `waypoint-student-coach`" in sent["instructions"] or "--- Skill `waypoint-onboarding`" in sent["instructions"]


# --- runtime provisioning ---------------------------------------------------------------------------

def test_prune_removes_only_bundled_skills(tmp_path: Path):
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
    from runtime import prune_bundled_skills

    skills = tmp_path / "skills"
    for rel in ("creative/ascii-art", "apple/notes", "hermes-agent", "waypoint-quiz", "learned-skills/my-own"):
        (skills / rel).mkdir(parents=True)
        (skills / rel / "SKILL.md").write_text("x", encoding="utf-8")
    (skills / ".bundled_manifest").write_text("ascii-art:1\nnotes:2\nhermes-agent:3\nwaypoint-quiz:4\n", encoding="utf-8")

    assert sorted(prune_bundled_skills(skills)) == ["ascii-art", "notes"]
    assert not (skills / "creative").exists() and not (skills / "apple").exists()
    for kept in ("hermes-agent", "waypoint-quiz", "learned-skills/my-own"):
        assert (skills / kept / "SKILL.md").is_file()


# --- speed fixes from profiling ----------------------------------------------------------------------

def test_recording_the_same_fact_twice_is_a_no_op(client: TestClient):
    student_id, thread_id = _student(client)
    said = _say(thread_id, "I want to be a backend engineer")
    headers = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, scopes=("read", "facts"))}
    body = {"user_id": student_id, "category": "goal", "key": "career_direction", "value": "backend engineer",
            "source_message_id": said, "explicit": True, "source_kind": "chat"}
    first = client.post("/internal/hermes/facts", json=body, headers=headers).json()
    again = client.post("/internal/hermes/facts", json={**body, "value": "Backend Engineer"}, headers=headers).json()
    assert again["already_recorded"] and again["fact_id"] == first["fact_id"] and "Do not record" in again["note"]
    from app.models import StudentFact
    with SessionLocal() as db:
        rows = db.query(StudentFact).filter(StudentFact.student_id == student_id, StudentFact.key == "career_direction").all()
    assert len(rows) == 1 and rows[0].active
    changed = client.post("/internal/hermes/facts", json={**body, "value": "data engineer"}, headers=headers).json()
    assert changed["fact_id"] != first["fact_id"] and "already_recorded" not in changed


def test_each_fallback_rung_gets_a_fresh_gateway_session(monkeypatch: pytest.MonkeyPatch):
    from app import hermes as hermes_module

    hermes_module._cooldown.clear()
    sessions = []

    class Response:
        def __init__(self, status, payload):
            self.status_code, self._payload, self.text = status, payload, ""

        def json(self):
            return self._payload

        def raise_for_status(self):
            return None

    class Client:
        def post(self, url, headers=None, json=None):
            if url.endswith("/stop"):
                return Response(200, {})
            sessions.append(json["session_id"])
            return Response(202, {"run_id": f"run-{len(sessions)}"})

        def get(self, url, headers=None):
            if url.endswith("run-1"):
                return Response(200, {"status": "failed", "error": "Gemini HTTP 503 UNAVAILABLE"})
            return Response(200, {"status": "completed", "output": "ok"})

    monkeypatch.setattr(hermes_module, "_poll_delay", lambda _attempt: 0)
    output, *_ = hermes_module.execute_with_fallback(
        Client(), {"Idempotency-Key": "k"}, {"input": "hi", "session_id": "thread-abc"}, "gemini", None, 30)
    assert output == "ok" and sessions == ["thread-abc", "thread-abc-r1"]
    hermes_module._cooldown.clear()


def test_gateway_config_fails_fast_and_skips_title_calls():
    import yaml

    config = yaml.safe_load((Path(__file__).resolve().parents[3] / "services/hermes/config.yaml").read_text(encoding="utf-8"))
    assert config["agent"]["api_max_retries"] == 1 and config["agent"]["auto_recovery_cycles"] == 0
    assert config["auxiliary"]["title_generation"] == {"enabled": False, "model_upgrade_enabled": False}


def test_settings_model_choice_drives_runs_without_a_request_model(client: TestClient):
    from app.hermes import candidate_chain

    assert client.put("/api/settings/hermes-model", json={"provider": "nim", "model": "nvidia/nemotron-3-super-120b-a12b"}).status_code == 200
    try:
        assert candidate_chain(None, None)[0] == ("nvidia/nemotron-3-super-120b-a12b", "nvidia")
        # A request that names its own model still wins.
        assert candidate_chain("gemini", "gemini-2.5-flash")[0] == ("gemini-2.5-flash", "gemini")
    finally:
        client.put("/api/settings/hermes-model", json={"provider": "gemini"})


def test_a_rung_that_timed_out_rests_so_the_next_run_falls_back_at_once():
    from app.hermes import _cooldown, _ready, cool_down

    chain = [("slow-model", "nvidia"), ("quick-model", "nvidia")]
    _cooldown.pop("slow-model", None)
    try:
        cool_down("slow-model", "slow-model: no answer within 90s")
        assert _ready(chain) == [("quick-model", "nvidia")]
    finally:
        _cooldown.pop("slow-model", None)
    cool_down("slow-model", "returned an empty answer")
    assert "slow-model" not in _cooldown


# --- ask_question / ready tools, live progress, stall fallback ------------------------------------

def _running_run(thread_id: str, message_id: str) -> str:
    from app.models import AgentRun

    with SessionLocal() as db:
        run = AgentRun(thread_id=thread_id, user_message_id=message_id, status="running")
        db.add(run)
        db.commit()
        return run.id


def test_ask_question_stages_cards_on_the_run_and_lands_on_the_reply(client: TestClient):
    from app.chat_ui import merge_staged_ui
    from app.models import AgentRun

    student_id, thread_id = _student(client, "Asker")
    run_id = _running_run(thread_id, _say(thread_id, "Help me pick a direction"))
    grant = issue_test_grant(student_id, ("ask",), agent_run_id=run_id)
    headers = {**INTERNAL, "X-Waypoint-Grant": grant}
    body = {"user_id": student_id, "question": "Which path fits you?",
            "options": [{"title": "Machine learning", "description": "Models and data"}, {"title": "Machine learning"}, {"title": "Backend"}]}
    reply = client.post("/internal/hermes/ask", json=body, headers=headers)
    assert reply.status_code == 200 and "do not list" in reply.json()["note"]
    # One option is not a question; neither is an empty ask.
    assert client.post("/internal/hermes/ask", json={**body, "options": [{"title": "Only"}]}, headers=headers).status_code == 422
    assert client.post("/internal/hermes/ask", json={"question": "Why?"}, headers=headers).status_code == 422

    with SessionLocal() as db:
        ui = __import__("json").loads(merge_staged_ui(db.get(AgentRun, run_id), None))
    options = ui["choice_group"]["options"]
    assert [item["id"] for item in options] == ["machine-learning", "machine-learning-2", "backend"]
    assert options[1]["description"] == "Machine learning" and ui["choice_group"]["mode"] == "single"

    # Without the ask scope, or once the run ended, the tool is refused.
    assert client.post("/internal/hermes/ask", json=body, headers={**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, ("read",), agent_run_id=run_id)}).status_code == 403
    with SessionLocal() as db:
        db.get(AgentRun, run_id).status = "completed"
        db.commit()
    assert client.post("/internal/hermes/ask", json=body, headers=headers).status_code == 403


def test_ready_to_generate_is_onboarding_only(client: TestClient):
    from app.chat_ui import merge_staged_ui
    from app.models import AgentRun, StudentProfile

    student_id, thread_id = _student(client, "Ready")
    run_id = _running_run(thread_id, _say(thread_id, "I think that's everything"))
    headers = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, ("ask",), agent_run_id=run_id)}
    with SessionLocal() as db:
        db.get(StudentProfile, student_id).onboarding_status = "done"
        db.commit()
    refused = client.post("/internal/hermes/onboarding/ready", json={}, headers=headers)
    assert refused.status_code == 409
    # The refusal is the last thing the model reads before replying, so it must steer the model back
    # to the student's question instead of letting it narrate a missing button.
    assert "answer their question" in refused.json()["detail"]
    with SessionLocal() as db:
        db.get(StudentProfile, student_id).onboarding_status = "chat"
        db.commit()
    assert client.post("/internal/hermes/onboarding/ready", json={}, headers=headers).status_code == 200
    with SessionLocal() as db:
        assert __import__("json").loads(merge_staged_ui(db.get(AgentRun, run_id), None))["ready_to_generate"] is True


def test_coach_instructions_forbid_the_onboarding_generate_tool(client: TestClient):
    """The coach must never re-open the onboarding-only Generate path (it burned a whole reply)."""
    from app.hermes import instructions_for
    from app.models import StudentProfile

    student_id, _ = _student(client, "Coach Ready")
    with SessionLocal() as db:
        profile = db.get(StudentProfile, student_id)
        profile.onboarding_status = "chat"
        db.commit()
        onboarding = instructions_for(student_id, db)
        profile.onboarding_status = "done"
        db.commit()
        coach = instructions_for(student_id, db)
    # Onboarding still tells Hermes when to show the button; the coach is told never to touch it.
    assert "call waypoint_ready_to_generate" in onboarding
    assert "never call it from this chat" in coach
    assert "waypoint_get_active_roadmap first" in coach
    assert "never call it from this chat" not in onboarding


# --- waypoint_show_element (chat elements: quiz, timer, progress, ...) ----------------------------

def test_show_element_stages_a_quiz_and_requires_grant_and_running_run(client: TestClient):
    from app.chat_ui import merge_staged_ui
    from app.models import AgentRun

    student_id, thread_id = _student(client, "Quizzer")
    run_id = _running_run(thread_id, _say(thread_id, "Quiz me on probability, 5 questions"))
    grant = issue_test_grant(student_id, ("ask",), agent_run_id=run_id)
    headers = {**INTERNAL, "X-Waypoint-Grant": grant}
    body = {
        "user_id": student_id, "kind": "quiz", "id": "quiz-probability", "title": "Probability",
        "questions": [
            {"id": "q1", "type": "mcq", "stem": "Coin flips twice: P(exactly one head)?",
             "options": ["1/4", "1/2", "3/4", "1/3"], "answer": "1/2", "explanation": "2 of 4 outcomes."},
            {"id": "q2", "type": "true_false", "stem": "Independent events multiply.", "answer": "True"},
        ],
    }
    reply = client.post("/internal/hermes/elements", json=body, headers=headers)
    assert reply.status_code == 200 and "rendered" in reply.json()["note"]

    with SessionLocal() as db:
        ui = __import__("json").loads(merge_staged_ui(db.get(AgentRun, run_id), None))
    elements = ui["elements"]
    assert len(elements) == 1 and elements[0]["kind"] == "quiz"
    assert elements[0]["questions"][0]["answer"] == "1/2"

    # Without the ask scope, or once the run ended, the tool is refused.
    other_grant = issue_test_grant(student_id, ("read",), agent_run_id=run_id)
    assert client.post("/internal/hermes/elements", json=body, headers={**INTERNAL, "X-Waypoint-Grant": other_grant}).status_code == 403
    with SessionLocal() as db:
        db.get(AgentRun, run_id).status = "completed"
        db.commit()
    assert client.post("/internal/hermes/elements", json=body, headers=headers).status_code == 403


def test_show_element_rejects_invalid_or_oversized_payloads(client: TestClient):
    student_id, thread_id = _student(client, "Rejector")
    run_id = _running_run(thread_id, _say(thread_id, "Quiz me"))
    headers = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, ("ask",), agent_run_id=run_id)}

    # Unknown kind.
    assert client.post("/internal/hermes/elements", json={"user_id": student_id, "kind": "essay", "id": "x"}, headers=headers).status_code == 422
    # An mcq question with only one option.
    bad_quiz = {"user_id": student_id, "kind": "quiz", "id": "q", "questions": [
        {"id": "q1", "type": "mcq", "stem": "?", "options": ["only"], "answer": "only"},
    ]}
    assert client.post("/internal/hermes/elements", json=bad_quiz, headers=headers).status_code == 422
    # 11 questions exceeds the 10-question cap.
    too_many = {"user_id": student_id, "kind": "quiz", "id": "q", "questions": [
        {"id": f"q{i}", "type": "true_false", "stem": "?", "answer": "True"} for i in range(11)
    ]}
    assert client.post("/internal/hermes/elements", json=too_many, headers=headers).status_code == 422
    # Code over the 4000-character cap.
    too_long_code = {"user_id": student_id, "kind": "code", "id": "c", "code": "x" * 4001}
    assert client.post("/internal/hermes/elements", json=too_long_code, headers=headers).status_code == 422


def test_show_element_caps_elements_per_reply(client: TestClient):
    from app.schemas import MAX_CHAT_ELEMENTS

    student_id, thread_id = _student(client, "Stacker")
    run_id = _running_run(thread_id, _say(thread_id, "Show me everything"))
    headers = {**INTERNAL, "X-Waypoint-Grant": issue_test_grant(student_id, ("ask",), agent_run_id=run_id)}
    for i in range(MAX_CHAT_ELEMENTS):
        body = {"user_id": student_id, "kind": "callout", "id": f"c{i}", "tone": "tip", "body": "Tip."}
        assert client.post("/internal/hermes/elements", json=body, headers=headers).status_code == 200
    overflow = {"user_id": student_id, "kind": "callout", "id": "overflow", "tone": "tip", "body": "One too many."}
    assert client.post("/internal/hermes/elements", json=overflow, headers=headers).status_code == 422


def test_parse_chat_output_recovers_a_bare_json_quiz_into_an_element():
    import json as _json

    from app.hermes import parse_chat_output
    from app.schemas import ChatMessageUi

    output = "Here's your quiz!\n```json\n" + _json.dumps({
        "questions": [
            {"type": "mcq", "question": "2+2?", "options": ["3", "4", "5"], "answer": "4", "explanation": "Arithmetic."},
            {"type": "true_false", "question": "The sky is blue.", "answer": "true"},
        ],
    }) + "\n```"
    visible, metadata_json = parse_chat_output(output)
    assert metadata_json is not None
    ui = ChatMessageUi.model_validate_json(metadata_json)
    assert len(ui.elements) == 1 and ui.elements[0].kind == "quiz"
    assert ui.elements[0].questions[0].answer == "4"
    assert ui.elements[0].questions[1].answer == "True"
    assert "```" not in visible


def test_parse_chat_output_fences_other_json_as_code_instead_of_prose():
    from app.hermes import parse_chat_output

    output = '{"summary": "not a quiz", "count": 3}'
    visible, metadata_json = parse_chat_output(output)
    assert metadata_json is None
    assert visible.startswith("```json") and visible.strip().endswith("```")
    assert '"summary": "not a quiz"' in visible


def test_live_progress_never_leaks_model_tokens_or_raw_preview_to_the_student(client: TestClient):
    import json as _json

    from app.hermes import LIVE_PROGRESS
    from app.main import _live_progress
    from app.models import AgentRun

    student_id, thread_id = _student(client, "Watcher")
    run_id = _running_run(thread_id, _say(thread_id, "How's it going?"))
    LIVE_PROGRESS[run_id] = {
        "phase": "tool", "tool": "waypoint_get_active_roadmap", "model": "nvidia/some-real-model",
        "started_at": 0.0, "phase_since": 0.0, "tokens": 1234, "tps": 42.0,
        "preview": "raw reasoning the student should never see", "steps": [{"tool": "x", "seconds": 1.0, "ok": True}],
        "notice": "Switched to gemini-2.5-flash", "attempt": 2,
    }
    try:
        with SessionLocal() as db:
            sanitized = _live_progress(db.get(AgentRun, run_id))
        assert sanitized["phase"] == "tool" and sanitized["tool"] == "waypoint_get_active_roadmap"
        assert sanitized["steps"] == [{"tool": "x", "seconds": 1.0, "ok": True}]
        assert sanitized["model"] is None and sanitized["tokens"] == 0 and sanitized["tps"] is None
        assert sanitized["preview"] == "" and sanitized["notice"] is None
        assert "real-model" not in _json.dumps(sanitized)
    finally:
        LIVE_PROGRESS.pop(run_id, None)


def test_nim_falls_back_to_the_nearest_faster_model_first():
    from app.hermes import NIM_CHAIN, _nim_order

    ultra, super_, lightning = NIM_CHAIN
    assert _nim_order(lightning) == [lightning, super_, ultra]
    assert _nim_order(super_) == [super_, lightning, ultra]
    assert _nim_order(ultra) == [ultra, super_, lightning]


class _Stream:
    def __init__(self, lines, status_code=200):
        self.lines, self.status_code = lines, status_code

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def iter_lines(self):
        yield from self.lines


class _EventsClient:
    """A gateway whose event stream yields `lines` once, then final status `final`."""

    def __init__(self, lines, final):
        self.lines, self.final, self.opened = lines, final, 0

    def stream(self, *_args, **_kwargs):
        self.opened += 1
        return _Stream(self.lines if self.opened == 1 else [])

    def get(self, *_args, **_kwargs):
        import httpx
        return httpx.Response(200, json=self.final, request=httpx.Request("GET", "http://gateway"))


def _data(event: dict) -> str:
    return "data: " + __import__("json").dumps(event)


def test_event_stream_reports_progress_and_returns_the_answer():
    from app.hermes import LIVE_PROGRESS, RunProgress, _follow_events

    progress = RunProgress("run-progress-test")
    progress.model("nvidia/lightning", 0)
    client = _EventsClient([
        ": open",
        _data({"event": "tool.started", "tool": "waypoint_get_student_profile", "seq": 0}),
        _data({"event": "tool.completed", "tool": "waypoint_get_student_profile", "seq": 1}),
        _data({"event": "message.delta", "delta": "Hello there. ", "seq": 2}),
        _data({"event": "message.delta", "delta": "Pick one.\n```waypoint-ui\n{}", "seq": 3}),
        _data({"event": "run.completed", "seq": 4}),
    ], {"status": "completed", "output": "Hello there. Pick one."})
    import time as _time
    state = _follow_events(client, "http://gateway", "r1", {}, _time.monotonic() + 30, lambda: None, progress)
    assert state["output"] == "Hello there. Pick one."
    live = LIVE_PROGRESS["run-progress-test"]
    assert live["phase"] == "writing" and live["model"] == "nvidia/lightning"
    assert [step["tool"] for step in live["steps"]] == ["waypoint_get_student_profile"]
    assert live["preview"] == "Hello there. Pick one.\n" and live["tokens"] > 0
    progress.done()
    assert "run-progress-test" not in LIVE_PROGRESS


def test_a_silent_model_counts_as_stalled_but_a_long_tool_does_not(monkeypatch):
    from app import hermes as hermes_module

    clock = iter(range(0, 10_000, 30))
    monkeypatch.setattr(hermes_module.time, "monotonic", lambda: next(clock))
    silent = _EventsClient([": keepalive", ": keepalive", ": keepalive"], {"status": "running"})
    assert hermes_module._follow_events(silent, "http://g", "r", {}, 10_000, lambda: None, None)["status"] == "stalled"

    clock = iter(range(0, 10_000, 30))
    busy_tool = _EventsClient([_data({"event": "tool.started", "tool": "waypoint_index_folder"}), ": keepalive", ": keepalive",
                               _data({"event": "run.completed"})], {"status": "completed", "output": "Done"})
    assert hermes_module._follow_events(busy_tool, "http://g", "r", {}, 10_000, lambda: None, None)["output"] == "Done"


def test_a_stalled_rung_moves_on_and_rests_only_briefly(monkeypatch):
    from app import hermes as hermes_module

    monkeypatch.setattr(hermes_module, "candidate_chain", lambda *_a, **_k: [("slow", "nvidia"), ("quick", "nvidia")])
    monkeypatch.setattr(hermes_module, "_cancel_gateway_run", lambda *_a, **_k: None)
    calls = []

    def follow(_client, _base, run_id, *_args):
        calls.append(run_id)
        return {"status": "stalled"} if run_id == "run-0" else {"status": "completed", "output": "Answer"}
    monkeypatch.setattr(hermes_module, "_follow_events", follow)

    class Gateway:
        posts = 0

        def stream(self):
            pass

        def post(self, *_args, **_kwargs):
            import httpx
            Gateway.posts += 1
            return httpx.Response(202, json={"run_id": f"run-{Gateway.posts - 1}"}, request=httpx.Request("POST", "http://g"))

    hermes_module._cooldown.pop("slow", None)
    try:
        output, model, _ = hermes_module.execute_with_fallback(Gateway(), {"Idempotency-Key": "k"}, {"session_id": "s"}, None, None, 60)
        assert (output, model, calls) == ("Answer", "quick", ["run-0", "run-1"])
        rest = hermes_module._cooldown["slow"] - hermes_module.time.monotonic()
        assert 0 < rest <= 60
    finally:
        hermes_module._cooldown.pop("slow", None)


def test_speed_check_times_every_model_of_a_provider(client: TestClient, monkeypatch):
    from app import model_speed

    monkeypatch.setattr(model_speed, "probe", lambda provider, model, key: {"model": model, "first_token": 0.5, "seconds": 1.0, "tps": 40.0})
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-" + "x" * 30)
    result = client.post("/api/settings/models/speed", json={"provider": "nim"}).json()
    assert [item["model"] for item in result["results"]] == [item.id for item in model_speed.PROVIDERS["nim"].models]
    assert client.post("/api/settings/models/speed", json={"provider": "custom"}).status_code == 422
    monkeypatch.delenv("NVIDIA_API_KEY")
    assert client.post("/api/settings/models/speed", json={"provider": "nim"}).status_code == 409
    remote = TestClient(client.app, base_url="http://waypoint.example")
    assert remote.post("/api/settings/models/speed", json={"provider": "nim"}).status_code == 403
