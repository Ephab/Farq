"""Central team Hermes: budgets, durable claiming, grant-checked tools and idempotent completion (PostgreSQL)."""
from datetime import timedelta
import os
from pathlib import Path
import time
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
import jwt
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from collaboration import team_hermes
from collaboration.config import Settings
from support import ISSUER, SEED, make_settings as support_settings
from collaboration.database import team_session
from collaboration.identity import Identity
from collaboration.main import create_app
from collaboration.models import now
from collaboration.teams.models import Team, TeamAgentRun, TeamMember, TeamMessage, TeamProposal, TeamRunGrant

TOOL_TOKEN = "t" * 40
NAMES = ("alice", "bob", "outsider")


def hdr(name):
    return {"Authorization": "Bearer " + name}


def make_settings(url, **extra):
    return support_settings(url, teams_enabled=True, team_ai_enabled=True, hermes_api_key="k" * 24, hermes_tool_token=TOOL_TOKEN, **extra)


@pytest.fixture
def world(monkeypatch, request):
    url = os.getenv("COLLAB_TEST_DATABASE_URL")
    if not url:
        pytest.skip("COLLAB_TEST_DATABASE_URL required for team PostgreSQL checks")
    settings = make_settings(url, **getattr(request, "param", {}))
    for key, value in (("DATABASE_URL", url),):
        monkeypatch.setenv("COLLAB_" + key, value)
    schema = "collab_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        app = create_app(settings)
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)

        class Verified:
            def verify(self, token):
                if token not in NAMES:
                    raise jwt.InvalidTokenError()
                return Identity(ISSUER, token, token.title(), int(time.time()) + 300)

        app.state.verifier = Verified()
        # The poller thread is not started (TestClient without lifespan work); tests drive work_one directly.
        with TestClient(app, headers={"X-Waypoint-Client-Version": "9.0.0"}) as client:
            ids = {name: client.get("/v1/me", headers=hdr(name)).json()["id"] for name in NAMES}
            team = client.post("/v1/teams", json={"name": "Hermes team"}, headers=hdr("alice")).json()["id"]
            invite = client.post(f"/v1/teams/{team}/invites", json={"user_id": ids["bob"]}, headers=hdr("alice")).json()["id"]
            assert client.post(f"/v1/invites/{invite}/accept", headers=hdr("bob")).status_code == 200
            yield client, app, settings, ids, team
    finally:
        engine.dispose()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def split(title, ids):
    return {"tasks": [{"title": f"{title} {name}", "assignee_id": ids[name], "estimate_points": 1, "rationale": "fit"} for name in ("alice", "bob")]}


def ask(client, team, who="alice", content="@hermes what is next?"):
    return client.post(f"/v1/teams/{team}/messages", json={"content": content}, headers=hdr(who))


def tool_headers(grant, token=TOOL_TOKEN):
    return {"X-Waypoint-Internal-Token": token, "X-Waypoint-Grant": grant}


def grant_from(request):
    return request["body"]["input"].split("grant=")[1].split(".")[0]


def run_id_from(request):
    return request["body"]["input"].split("run_id=")[1].split(";")[0]


def replies(app, team):
    with app.state.sessions() as db:
        return [m.content for m in db.scalars(select(TeamMessage).where(TeamMessage.team_id == team, TeamMessage.author_user_id.is_(None)))]


def test_mention_queues_one_run_with_the_message_and_hermes_off_stays_503(world, monkeypatch):
    client, app, settings, ids, team = world
    assert ask(client, team).status_code == 201
    assert client.post(f"/v1/teams/{team}/messages", json={"content": "plain chat"}, headers=hdr("bob")).status_code == 201
    with app.state.sessions() as db:
        runs = db.scalars(select(TeamAgentRun)).all()
    assert [(run.status, run.command, run.invoked_by_user_id) for run in runs] == [("queued", "mention", ids["alice"])]
    assert ask(client, team, "outsider").status_code == 403
    app.state.settings = settings.model_copy(update={"team_ai_enabled": False})
    assert ask(client, team).status_code == 503


def test_no_run_limit(world):
    client, app, *_ , team = world
    assert [ask(client, team).status_code for _ in range(12)] == [201] * 12
    with app.state.sessions() as db:
        assert len(db.scalars(select(TeamAgentRun)).all()) == 12


def test_run_uses_tools_as_the_invoker_and_posts_exactly_one_reply(world):
    client, app, settings, ids, team = world
    ask(client, team)
    seen = {}

    def gateway(_settings, request):
        grant, run_id = grant_from(request), run_id_from(request)
        seen.update(grant=grant, run_id=run_id, instructions=request["body"]["instructions"])
        context = client.get(f"/internal/hermes/teams/{team}/context", params={"run_id": run_id}, headers=tool_headers(grant))
        seen["context_status"] = (context.status_code, context.text[:300])
        seen["context"] = context.json() if context.status_code == 200 else {}
        proposal = client.post(f"/internal/hermes/teams/{team}/proposals", headers=tool_headers(grant), json={
            "run_id": run_id, "kind": "task_split", "summary": "Start the board",
            "payload": split("Write the plan", ids)})
        seen["proposal_status"] = (proposal.status_code, proposal.text[:400])
        return "Proposed a first task; it is waiting for the team."

    assert team_hermes.work_one(app.state.sessions, settings, gateway) is True
    assert team_hermes.work_one(app.state.sessions, settings, gateway) is False
    assert seen["context_status"][0] == 200, seen["context_status"]
    assert seen["proposal_status"][0] == 201, seen["proposal_status"]
    assert seen["context"]["acting_user"]["id"] == ids["alice"]
    assert all(card["facts"] == [] and card["roadmap"] is None for card in seen["context"]["teammates"])
    assert "waypoint_propose_batch" in seen["instructions"]
    with app.state.sessions() as db:
        run = db.scalars(select(TeamAgentRun)).one()
        assert (run.status, run.attempts) == ("completed", 1)
        assert db.get(TeamMessage, run.reply_message_id).content.startswith("Proposed a first task")
        proposal = db.scalars(select(TeamProposal)).one()
        assert (proposal.status, proposal.run_id, proposal.invoked_by) == ("pending", run.id, ids["alice"])
        assert db.scalars(select(TeamRunGrant)).all() == []
        assert db.scalars(select(Team)).one().id == team
    assert sum(text.startswith("Proposed a first task") for text in replies(app, team)) == 1
    # The finished run's grant is dead.
    dead = client.get(f"/internal/hermes/teams/{team}/context", params={"run_id": seen["run_id"]}, headers=tool_headers(seen["grant"]))
    assert dead.status_code == 403


def test_tools_reject_missing_forged_wrong_run_and_wrong_team(world):
    client, app, settings, ids, team = world
    other = client.post("/v1/teams", json={"name": "Other"}, headers=hdr("alice")).json()["id"]
    ask(client, team)
    outcomes = {}

    def gateway(_settings, request):
        grant, run_id = grant_from(request), run_id_from(request)
        url = f"/internal/hermes/teams/{team}/context"
        outcomes["no_service_token"] = client.get(url, params={"run_id": run_id}, headers={"X-Waypoint-Grant": grant}).status_code
        outcomes["bad_service_token"] = client.get(url, params={"run_id": run_id}, headers=tool_headers(grant, "x" * 40)).status_code
        outcomes["no_grant"] = client.get(url, params={"run_id": run_id}, headers={"X-Waypoint-Internal-Token": TOOL_TOKEN}).status_code
        outcomes["forged_grant"] = client.get(url, params={"run_id": run_id}, headers=tool_headers("g" * 43)).status_code
        outcomes["no_run_id"] = client.get(url, headers=tool_headers(grant)).status_code
        outcomes["other_run_id"] = client.get(url, params={"run_id": str(uuid4())}, headers=tool_headers(grant)).status_code
        outcomes["other_team"] = client.get(f"/internal/hermes/teams/{other}/context", params={"run_id": run_id}, headers=tool_headers(grant)).status_code
        outcomes["ok"] = client.get(url, params={"run_id": run_id}, headers=tool_headers(grant)).status_code
        return "done"

    team_hermes.work_one(app.state.sessions, settings, gateway)
    assert outcomes == {"no_service_token": 403, "bad_service_token": 403, "no_grant": 403, "forged_grant": 403,
                        "no_run_id": 422, "other_run_id": 403, "other_team": 403, "ok": 200}


def test_removing_the_invoker_mid_run_stops_every_tool_call(world):
    client, app, settings, ids, team = world
    ask(client, team, "bob")
    result = {}

    def gateway(_settings, request):
        grant, run_id = grant_from(request), run_id_from(request)
        url = f"/internal/hermes/teams/{team}/context"
        result["before"] = client.get(url, params={"run_id": run_id}, headers=tool_headers(grant)).status_code
        with team_session(app.state.sessions) as db:
            db.delete(db.scalar(select(TeamMember).where(TeamMember.team_id == team, TeamMember.user_id == ids["bob"])))
            db.commit()
        result["after"] = client.get(url, params={"run_id": run_id}, headers=tool_headers(grant)).status_code
        result["propose"] = client.post(f"/internal/hermes/teams/{team}/proposals", headers=tool_headers(grant), json={
            "run_id": run_id, "kind": "task_split", "payload": {"tasks": []}}).status_code
        return "late reply"

    team_hermes.work_one(app.state.sessions, settings, gateway)
    assert result == {"before": 200, "after": 403, "propose": 403}


@pytest.mark.parametrize("world", [{"proposals_per_run": 2}], indirect=True)
def test_proposals_are_capped_per_run_and_retries_do_not_duplicate(world):
    client, app, settings, ids, team = world
    ask(client, team)
    codes = []

    def gateway(_settings, request):
        grant, run_id = grant_from(request), run_id_from(request)

        def propose(title):
            return client.post(f"/internal/hermes/teams/{team}/proposals", headers=tool_headers(grant), json={
                "run_id": run_id, "kind": "task_split", "summary": title,
                "payload": split(title, ids)})

        first = propose("One")
        again = propose("One")
        assert first.json()["proposal"]["id"] == again.json()["proposal"]["id"]
        codes.extend([propose("Two").status_code, propose("Three").status_code])
        return "ok"

    team_hermes.work_one(app.state.sessions, settings, gateway)
    assert codes == [201, 429]
    with app.state.sessions() as db:
        assert len(db.scalars(select(TeamProposal)).all()) == 2


def test_lost_lease_is_retried_and_only_the_current_claim_can_reply(world):
    client, app, settings, ids, team = world
    ask(client, team)
    first = team_hermes.claim_next(app.state.sessions, settings)
    assert first is not None and team_hermes.claim_next(app.state.sessions, settings) is None  # one at a time per team
    with team_session(app.state.sessions) as db:
        db.get(TeamAgentRun, first[0]).lease_expires = now() - timedelta(seconds=1)
        db.commit()
    second = team_hermes.claim_next(app.state.sessions, settings)
    assert second is not None and second[0] == first[0] and second[1] != first[1]
    # The first worker wakes up late: nothing it does can post or change the run.
    assert team_hermes.finish(app.state.sessions, first[0], first[1], "stale reply") is False
    assert team_hermes.finish(app.state.sessions, first[0], first[1], None, "stale failure") is False
    assert team_hermes.finish(app.state.sessions, second[0], second[1], "real reply") is True
    assert team_hermes.finish(app.state.sessions, second[0], second[1], "real reply") is False
    texts = replies(app, team)
    assert texts.count("real reply") == 1 and "stale reply" not in texts
    with app.state.sessions() as db:
        assert db.get(TeamAgentRun, first[0]).attempts == 2


@pytest.mark.parametrize("world", [{"run_max_attempts": 1}], indirect=True)
def test_exhausted_attempts_fail_privately_to_the_invoker(world):
    client, app, settings, ids, team = world
    ask(client, team)
    claimed = team_hermes.claim_next(app.state.sessions, settings)
    with team_session(app.state.sessions) as db:
        db.get(TeamAgentRun, claimed[0]).lease_expires = now() - timedelta(seconds=1)
        db.commit()
    assert team_hermes.claim_next(app.state.sessions, settings) is None
    with app.state.sessions() as db:
        run = db.get(TeamAgentRun, claimed[0])
        assert run.status == "failed"
        notice = db.scalars(select(TeamMessage).where(TeamMessage.kind == "system")).one()
        assert notice.visible_to_user_id == ids["alice"]
    assert team_hermes.finish(app.state.sessions, claimed[0], claimed[1], "too late") is False


def test_gateway_failure_is_stored_not_faked(world):
    client, app, settings, ids, team = world
    ask(client, team)

    def broken(_settings, _request):
        raise team_hermes.GatewayError("Hermes gateway unreachable (ConnectError)")

    assert team_hermes.work_one(app.state.sessions, settings, broken) is True
    with app.state.sessions() as db:
        run = db.scalars(select(TeamAgentRun)).one()
        assert run.status == "failed" and "unreachable" in run.error and run.reply_message_id is None
        assert db.scalars(select(TeamRunGrant)).all() == []
    assert not any("I finished" in text for text in replies(app, team))


def test_catchup_reply_is_visible_only_to_the_asker(world):
    client, app, settings, ids, team = world
    ask(client, team, "bob", "/catchup")
    seen = {}

    def gateway(_settings, request):
        seen["input"] = request["body"]["input"]
        return "Here is what changed."

    team_hermes.work_one(app.state.sessions, settings, gateway)
    assert "Events for this member" in seen["input"]
    with app.state.sessions() as db:
        reply = db.scalars(select(TeamMessage).where(TeamMessage.content == "Here is what changed.")).one()
        assert reply.visible_to_user_id == ids["bob"]


def test_ai_settings_are_validated():
    base = dict(_env_file=None, environment="production", database_url="postgresql+psycopg://u:p@db/x",
                device_signing_key=SEED, teams_enabled=True, allowed_origins=[])
    with pytest.raises(ValueError, match="COLLAB_HERMES_API_KEY"):
        Settings(**base, team_ai_enabled=True, hermes_tool_token=TOOL_TOKEN)
    with pytest.raises(ValueError, match="COLLAB_HERMES_TOOL_TOKEN"):
        Settings(**base, team_ai_enabled=True, hermes_api_key="k" * 24, hermes_tool_token="short")
    with pytest.raises(ValueError, match="HTTPS or on loopback"):
        Settings(**base, team_ai_enabled=True, hermes_api_key="k" * 24, hermes_tool_token=TOOL_TOKEN, hermes_url="http://gateway.example")
    with pytest.raises(ValueError, match="requires teams"):
        Settings(**{**base, "teams_enabled": False}, team_ai_enabled=True, hermes_api_key="k" * 24, hermes_tool_token=TOOL_TOKEN)
    assert Settings(**base).team_ai_enabled is False


def test_gateway_client_polls_to_completion_and_stops_a_stalled_run(monkeypatch):
    import httpx
    settings = make_settings("postgresql+psycopg://u:p@db/x", run_timeout_seconds=10)
    request = {"body": {"input": "x"}, "key": "team-run-1-1", "team_id": "t"}
    seen = []

    def handler(req: httpx.Request):
        seen.append((req.method, req.url.path, req.headers.get("authorization"), req.headers.get("idempotency-key")))
        if req.method == "POST" and req.url.path == "/v1/runs":
            return httpx.Response(200, json={"run_id": "g1"})
        return httpx.Response(200, json={"status": "completed", "output": " Done. "})

    real = httpx.Client
    monkeypatch.setattr(team_hermes.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    assert team_hermes.call_gateway(settings, request) == "Done."
    assert seen[0] == ("POST", "/v1/runs", "Bearer " + "k" * 24, "team-run-1-1")

    def stalled(req: httpx.Request):
        seen.append((req.method, req.url.path))
        if req.method == "POST" and req.url.path == "/v1/runs":
            return httpx.Response(200, json={"run_id": "g2"})
        return httpx.Response(200, json={"status": "running"})

    clock = iter([0, 0, 5, 11, 11, 11])
    monkeypatch.setattr(team_hermes.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(team_hermes.time, "sleep", lambda _s: None)
    monkeypatch.setattr(team_hermes.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(stalled), **kw))
    with pytest.raises(team_hermes.GatewayError, match="did not finish"):
        team_hermes.call_gateway(settings, request)
    assert ("POST", "/v1/runs/g2/stop") in seen


@pytest.mark.parametrize("world", [{"min_client_version": "0.2.0"}], indirect=True)
def test_unsupported_clients_get_426_but_can_read_capabilities(world):
    client, app, settings, ids, team = world
    for value in ("0.1.9", "", "garbage", "0.2"):
        old = client.get("/v1/me", headers={**hdr("alice"), "X-Waypoint-Client-Version": value})
        assert old.status_code == 426 and old.json()["min_client_version"] == "0.2.0", value
    assert client.get("/v1/me", headers={**hdr("alice"), "X-Waypoint-Client-Version": "0.2.0"}).status_code == 200
    assert client.get("/v1/me", headers={**hdr("alice"), "X-Waypoint-Client-Version": "0.10.0"}).status_code == 200
    capabilities = client.get("/v1/capabilities", headers={**hdr("alice"), "X-Waypoint-Client-Version": "0.0.1"}).json()
    assert capabilities["api_version"] == 1 and capabilities["min_client_version"] == "0.2.0" and capabilities["team_ai"] is True
    assert client.get("/health/live").status_code == 200


def test_a_busy_model_moves_on_to_the_next_one_but_other_failures_do_not(monkeypatch):
    import httpx
    settings = make_settings("postgresql+psycopg://u:p@db/x", run_timeout_seconds=10, hermes_fallback_models=["m2", "m3"])
    request = {"body": {"input": "x", "session_id": "s"}, "key": "k1", "team_id": "t"}
    models, keys = [], []
    failure = {"m2": None}

    def handler(req: httpx.Request):
        if req.method == "POST":
            import json
            models.append(json.loads(req.content).get("model"))
            keys.append(req.headers["idempotency-key"])
            return httpx.Response(200, json={"run_id": f"g{len(models)}"})
        current = models[-1]
        if current is None:
            return httpx.Response(200, json={"status": "failed", "error": "Gemini HTTP 503 (UNAVAILABLE): high demand"})
        if failure.get(current):
            return httpx.Response(200, json={"status": "failed", "error": failure[current]})
        return httpx.Response(200, json={"status": "completed", "output": "ok"})

    real = httpx.Client
    monkeypatch.setattr(team_hermes.httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(team_hermes.time, "sleep", lambda _s: None)
    assert team_hermes.call_gateway(settings, request) == "ok"
    assert models == [None, "m2"] and keys == ["k1", "k1-m1"]
    models.clear(); keys.clear(); failure["m2"] = "Tool grant rejected"
    with pytest.raises(team_hermes.GatewayError, match="Tool grant rejected"):
        team_hermes.call_gateway(settings, request)
    assert models == [None, "m2"]
