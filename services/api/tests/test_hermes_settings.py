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
    assert {c["id"] for c in listing} == {"blackboard", "hackathons", "coop", "outlook"}
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
