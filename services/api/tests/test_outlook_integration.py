import json
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from test_outlook import world, insert_item, ORIGIN  # noqa: F401
from app.outlook import auth, chat, graph
from app.outlook.models import MailConnection


def mock_profile(monkeypatch):
    monkeypatch.setattr(graph.httpx, "get", lambda *args, **kwargs: httpx.Response(200, json={
        "id": "graph-account", "mail": "synthetic@outlook.com", "displayName": "Synthetic student"
    }, request=httpx.Request("GET", "https://graph.microsoft.com/v1.0/me")))


def test_temporary_connection_uses_encrypted_private_cache(world, monkeypatch):
    client, factory, _ = world
    mock_profile(monkeypatch)
    client.cookies.clear()
    secret = "synthetic-token-" * 8
    result = client.post("/api/outlook/token", json={"access_token": secret, "accepted": True})
    assert result.status_code == 200
    assert secret not in result.text
    with factory() as db:
        conn = db.scalar(select(MailConnection).where(MailConnection.account_id == "graph-account"))
        assert conn.user_id not in {"alice", "bob"}
        assert secret not in conn.token_cache
        assert auth.token_for(conn)[0] == secret
    assert client.get("/api/outlook/status").json()["provider"] == "token"
    assert client.get("/api/outlook/messages").status_code == 200
    assert client.delete("/api/outlook/connection").status_code == 200
    assert client.get("/api/outlook/messages").status_code == 401


def test_temporary_token_needs_consent_origin_and_valid_token(world, monkeypatch):
    client, _, _ = world
    assert client.post("/api/outlook/token", json={"access_token": "short", "accepted": True}).status_code == 422
    body = {"access_token": "token" * 10, "accepted": False}
    assert client.post("/api/outlook/token", json=body).status_code == 403
    body["accepted"] = True
    assert client.post("/api/outlook/token", json=body, headers={"Origin": "https://evil.invalid"}).status_code == 403
    monkeypatch.setattr(graph.httpx, "get", lambda *args, **kwargs: httpx.Response(401, request=httpx.Request("GET", "https://graph.microsoft.com/v1.0/me")))
    assert client.post("/api/outlook/token", json=body).status_code == 401


def test_expired_temporary_token_requires_reconnect(world):
    stored = {"access_token": "test", "expires": time.time() - 1}
    with pytest.raises(ValueError, match="reauthorization_required"):
        auth.token_for(SimpleNamespace(tenant=auth.TOKEN_TENANT, token_cache=auth.seal(json.dumps(stored))))






def test_qa_requires_owned_unexpired_mail_and_explicit_consent(world, monkeypatch):
    client, factory, _ = world
    own = insert_item(factory)
    foreign = insert_item(factory, connection="bob")
    calls = []
    def answer(emails, question, *args):
        calls.append(emails)
        return {"answer": "Synthetic answer", "model": "mock", "provider": "mock"}
    monkeypatch.setattr(chat, "run_email_chat", answer)
    body = {"ids": [own], "question": "When?", "accepted": False}
    assert client.post("/api/outlook/chat", json=body).status_code == 403
    body["accepted"] = True
    body["ids"] = [own, foreign]
    assert client.post("/api/outlook/chat", json=body).status_code == 404
    assert not calls
    body["ids"] = [own]
    response = client.post("/api/outlook/chat", json=body)
    assert response.status_code == 200 and response.json()["email_count"] == 1
    assert calls[0][0]["body"] == "Private excerpt"
    assert response.headers["cache-control"] == "no-store"
    client.cookies.clear()
    assert client.post("/api/outlook/chat", json=body, headers={"X-Waypoint-User": "alice"}).status_code == 401


def test_prompt_is_untrusted_and_oversize_is_rejected_not_truncated():
    email = {"subject": "Lab", "sender": {"name": "TA", "address": ""}, "received": "2026-09-27", "body": "Finish by Friday", "preview": ""}
    prompt = chat.build_email_prompt([email], "When is it due?")
    assert "UNTRUSTED EMAIL DATA" in prompt and "Lab" in prompt and "Friday" in prompt
    assert "Do not call any tools" in chat.EMAIL_INSTRUCTIONS
    email["body"] = "x" * 24001
    with pytest.raises(chat.EmailChatError) as error:
        chat.build_email_prompt([email], "Summarize")
    assert error.value.status == 422
    with pytest.raises(chat.EmailChatError):
        chat.run_email_chat([], "   ")


def test_email_qa_uses_coach_gateway_and_fresh_session(world, monkeypatch):
    calls = []
    monkeypatch.setenv("HERMES_EMAIL_URL", "http://127.0.0.1:8643")
    monkeypatch.setattr(chat, "execute_with_fallback", lambda *args, **kwargs: (calls.append((args, kwargs)) or ("Answer", "mock-model", "mock-provider")))
    for _ in range(2):
        result = chat.run_email_chat([], "Question", hermes_api_key="test-key-123456789")
        assert result["model"] == "mock-model"
    assert calls[0][1]["gateway_url"] == chat.HERMES_URL
    assert calls[0][0][2]["session_id"] != calls[1][0][2]["session_id"]


def test_mail_session_does_not_replace_team_demo_identity(world):
    from app.identity import current_user, User
    from starlette.requests import Request
    _, factory, _ = world
    with factory() as db:
        db.add(User(id="demo-member", display_name="Demo", source="demo")); db.commit()
        def request(path):
            return Request({"type": "http", "path": path, "headers": [(b"cookie", b"waypoint_outlook_session=alice-cookie")]})
        assert current_user(request("/api/me"), db, "demo-member").id == "demo-member"
        assert current_user(request("/api/outlook/messages"), db, "demo-member").id == "alice"
        assert current_user(request("/api/chat/threads/t1/messages"), db, "demo-member").id == "demo-member"
        with pytest.raises(HTTPException):
            current_user(request("/api/me"), db, "alice")


@pytest.mark.parametrize("method,path", [("post", "/authorize"), ("get", "/callback"),
    ("post", "/personal/device/start"), ("post", "/personal/device/poll"), ("get", "/personal/config")])
def test_removed_sign_in_routes_are_unavailable(world, method, path):
    client, _, _ = world
    assert getattr(client, method)("/api/outlook" + path).status_code == 404


def test_retired_connections_are_not_exposed_or_synced(world, monkeypatch):
    from app.outlook import sync, desktop
    client, factory, _ = world
    with factory() as db:
        for key in ("alice", "bob"):
            db.get(MailConnection, key).tenant = "retired-entra"
        db.commit()
    assert client.get("/api/outlook/status").json()["connected"] is False
    assert client.get("/api/outlook/messages").status_code == 401
    monkeypatch.setattr(sync, "work_one_page", lambda *args: pytest.fail("Retired connection must not sync"))
    sync.tick()


def coach_request(cookie="alice-cookie"):
    from starlette.requests import Request
    return Request({"type": "http", "method": "POST", "path": "/api/chat/threads/t1/messages",
                    "headers": [(b"cookie", f"{auth.COOKIE}={cookie}".encode()), (b"origin", ORIGIN.encode())]})


def coach_grant(factory, status="running"):
    from app.models import AgentRun, ChatThread, Student
    from app.identity import User
    from app.outlook import coach
    with factory() as db:
        if db.get(Student, "alice") is None:
            db.add(Student(id="alice", display_name="alice"))
            db.flush()
            db.get(User, "alice").student_id = "alice"
            db.add(ChatThread(id="t1", student_id="alice"))
            db.flush()
        run = AgentRun(thread_id="t1", user_message_id="m1", status=status)
        db.add(run); db.flush()
        token = coach.issue_grant(coach_request(), db, run.id)
        db.commit()
        return token, run.id


def test_coach_mail_needs_session_consent_and_sees_only_owned_mail(world):
    from app.outlook import coach
    client, factory, _ = world
    own = insert_item(factory)
    with factory() as db:
        from app.outlook.models import MailItem
        db.get(MailItem, own).excerpt = "Private " + "A" * 8992
        db.commit()
    insert_item(factory, connection="bob")
    assert coach_grant(factory)[0] is None
    assert client.get("/api/outlook/status").json()["coach_access"] is False
    assert client.patch("/api/outlook/coach-access", json={"accepted": True}, headers={"Origin": "https://evil.test"}).status_code == 403
    assert client.patch("/api/outlook/coach-access", json={"accepted": True}).json() == {"coach_access": True}
    token, _ = coach_grant(factory)
    assert token
    with factory() as db:
        found = coach.search_mail(coach.MailSearch(mailbox_access=token, query="private"), db)
        assert [item["id"] for item in found["items"]] == [own]
        first = coach.read_mail(coach.MailRead(mailbox_access=token, item_id=own), db)
        assert len(first["body"]) == 8000 and first["next_cursor"] == 8000
        rest = coach.read_mail(coach.MailRead(mailbox_access=token, item_id=own, cursor=8000), db)
        assert len(rest["body"]) == 1000 and rest["next_cursor"] is None
        with pytest.raises(HTTPException):
            coach.search_mail(coach.MailSearch(mailbox_access="forged-" * 6), db)


def test_coach_mail_grant_rejects_another_students_run(world):
    from app.models import AgentRun, ChatThread, Student
    from app.outlook import coach

    client, factory, _ = world
    client.patch("/api/outlook/coach-access", json={"accepted": True})
    with factory() as db:
        db.add(Student(id="other-student", display_name="Other"))
        db.add(ChatThread(id="other-thread", student_id="other-student"))
        run = AgentRun(thread_id="other-thread", user_message_id="m1", status="running")
        db.add(run)
        db.flush()
        assert coach.issue_grant(coach_request(), db, run.id) is None


def test_coach_mail_revoked_by_consent_run_state_and_disconnect(world):
    from app.models import AgentRun
    from app.outlook import coach
    client, factory, _ = world
    insert_item(factory)
    client.patch("/api/outlook/coach-access", json={"accepted": True})
    finished, _ = coach_grant(factory, status="completed")
    token, run_id = coach_grant(factory)
    with factory() as db:
        with pytest.raises(HTTPException):
            coach.search_mail(coach.MailSearch(mailbox_access=finished), db)
        assert coach.search_mail(coach.MailSearch(mailbox_access=token), db)["items"]
    client.patch("/api/outlook/coach-access", json={"accepted": False})
    client.patch("/api/outlook/coach-access", json={"accepted": True})
    with factory() as db:
        with pytest.raises(HTTPException):  # re-enabling does not revive revoked grants
            coach.search_mail(coach.MailSearch(mailbox_access=token), db)
    token, _ = coach_grant(factory)
    assert client.delete("/api/outlook/connection").status_code == 200
    with factory() as db:
        with pytest.raises(HTTPException):
            coach.search_mail(coach.MailSearch(mailbox_access=token), db)
        assert db.get(AgentRun, run_id) is not None
