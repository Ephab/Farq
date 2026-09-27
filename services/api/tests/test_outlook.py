import json
import time
import uuid
from dataclasses import asdict
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.email_classifier import EmailClassification
from app.identity import User
from app.outlook import auth, sync
from app.outlook.models import MailConnection, MailFolder, MailItem, MailSession
from app.outlook.router import router

ORIGIN = "http://localhost:5173"


@pytest.fixture
def world(monkeypatch):
    values = {"OUTLOOK_APP_ORIGIN": ORIGIN, "OUTLOOK_LOCAL_TOKEN": "test-local-token-" * 4,
              "FARQ_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(), "OUTLOOK_SYNC_ENABLED": "true"}
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(router)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(sync, "SessionLocal", factory)
    monkeypatch.setattr(sync, "token_for", lambda connection: ("test-token", auth.seal("cache")))
    classification = EmailClassification("coursework", {}, .8, .8, .8, .2, ("uncalibrated_email_domain",))
    monkeypatch.setattr(sync, "_classifier", SimpleNamespace(classify=lambda email: classification))
    with factory() as db:
        for user_id in ("alice", "bob"):
            db.add(User(id=user_id, display_name=user_id, source="microsoft"))
            db.flush()
            db.add(MailConnection(id=user_id, user_id=user_id, account_id=user_id, tenant=auth.TOKEN_TENANT, label=user_id + "@uni.edu", token_cache=auth.seal("cache")))
            db.add(MailSession(token_hash=auth.digest(user_id + "-cookie"), user_id=user_id, expires=time.time() + 600))
        db.commit()
    with TestClient(app, base_url=ORIGIN) as client:
        client.cookies.set(auth.COOKIE, "alice-cookie")
        client.headers["Origin"] = ORIGIN
        yield client, factory, values
    engine.dispose()


def insert_item(factory, connection="alice", **kwargs):
    with factory() as db:
        item = MailItem(connection_id=connection, remote_id=str(uuid.uuid4()), folder_id="inbox", subject="Private mail",
                        sender="University", excerpt="Private excerpt", received="2026-09-26T10:00:00Z", web_url="", content_hash="hash",
                        expires=time.time() + 1000, **kwargs)
        db.add(item); db.commit()
        return item.id


def test_mailbox_requires_session_not_demo_header(world):
    client, factory, _ = world
    insert_item(factory, "alice")
    client.cookies.clear()
    assert client.get("/api/outlook/messages", headers={"X-Farq-User": "alice"}).status_code == 401
    assert client.get("/api/outlook/status").json()["connected"] is False


def test_owner_isolation_and_filters(world):
    client, factory, _ = world
    alice = insert_item(factory, pinned=True, due_date="2026-09-25")
    bob = insert_item(factory, "bob")
    result = client.get("/api/outlook/messages?view=important").json()
    assert [row["id"] for row in result["items"]] == [alice]
    assert client.patch(f"/api/outlook/messages/{bob}", json={"reviewed": True}).status_code == 404
    assert client.patch(f"/api/outlook/messages/{alice}", json={"due_date": "2026-09-27", "reviewed": True}).status_code == 200
    assert client.get("/api/outlook/messages?view=review").json()["total"] == 0
    assert client.get("/api/outlook/messages?view=today&day=2026-09-25").json()["total"] == 0


def test_csrf_disconnect_and_late_worker(world):
    client, factory, _ = world
    insert_item(factory)
    assert client.delete("/api/outlook/connection", headers={"Origin": "https://evil.test"}).status_code == 403
    assert client.delete("/api/outlook/connection").status_code == 200
    with factory() as db:
        assert db.get(MailConnection, "alice").token_cache == ""
        assert not db.scalars(select(MailItem).where(MailItem.connection_id == "alice")).all()
        assert not sync.lease_valid(db, "alice", 1, "")
    assert client.get("/api/outlook/messages").status_code == 401


def test_today_uses_local_midnight_and_excludes_next_day(world):
    client, factory, _ = world
    ids = [insert_item(factory) for _ in range(3)]
    with factory() as db:
        for item_id, received in zip(ids, ["2026-09-25T20:59:59Z", "2026-09-25T21:00:00Z", "2026-09-26T21:00:00Z"]):
            db.get(MailItem, item_id).received = received
        db.commit()
    result = client.get("/api/outlook/messages?view=today&day=2026-09-26&timezone_offset=-180").json()
    assert [item["id"] for item in result["items"]] == [ids[1]]




@pytest.mark.parametrize("url", ["http://graph.microsoft.com/v1.0/me/mailFolders", "https://evil.test/v1.0/me/mailFolders", "https://graph.microsoft.com/v1.0/users/bob/mailFolders", "https://graph.microsoft.com/v1.0/me/mailFolders/../sendMail", "https://graph.microsoft.com/v1.0/me/messages"])
def test_graph_url_allowlist(url):
    assert not sync.valid_graph_url(url, "alice")


def test_normalization_does_not_render_html_or_store_identifiers():
    subject, body = sync.normalize({"subject": "Student 123456789", "body": {"contentType": "html", "content": '<script>secret()</script><p>Email me a@uni.edu<img src="https://evil.test/pixel"></p>'}})
    assert "123456789" not in subject and "a@uni.edu" not in body and "secret" not in body and "evil.test" not in body
    assert sync.source_url("javascript:alert(1)") == ""




def test_sync_pagination_dedup_and_removed_message(world, monkeypatch):
    _, factory, _ = world
    with factory() as db:
        connection = db.get(MailConnection, "alice")
        connection.status, connection.lease_id, connection.lease_until = "running", "lease", time.time() + 600
        db.add(MailFolder(connection_id="alice", remote_id="inbox"))
        db.commit()
    message = {"id": "m1", "subject": "Exam", "body": {"contentType": "text", "content": "The exam is tomorrow."}}
    next_link = sync.GRAPH + "/me/mailFolders/inbox/messages/delta?$skiptoken=one"
    delta_link = sync.GRAPH + "/me/mailFolders/inbox/messages/delta?$deltatoken=two"
    pages = [{"value": [message, message], "@odata.nextLink": next_link}, {"value": [], "@odata.deltaLink": delta_link}]
    monkeypatch.setattr(sync, "graph_get", lambda *a: pages.pop(0))
    sync.work_one_page("alice", "lease")
    with factory() as db:
        assert len(db.scalars(select(MailItem)).all()) == 1
        folder = db.scalar(select(MailFolder))
        assert folder.next_page == next_link and not folder.completed
        db.get(MailConnection, "alice").lease_id = "lease"
        db.commit()
    sync.work_one_page("alice", "lease")
    with factory() as db:
        folder = db.scalar(select(MailFolder))
        assert folder.completed and folder.cursor == delta_link
        folder.completed = False
        db.get(MailConnection, "alice").lease_id = "lease"
        db.commit()
    monkeypatch.setattr(sync, "graph_get", lambda *a: {"value": [{"id": "m1", "@removed": {"reason": "deleted"}}], "@odata.deltaLink": delta_link})
    sync.work_one_page("alice", "lease")
    with factory() as db:
        item = db.scalar(select(MailItem))
        assert item.removed and not item.excerpt


def test_disconnect_during_classification_cannot_restore_data(world, monkeypatch):
    client, factory, _ = world
    with factory() as db:
        connection = db.get(MailConnection, "alice")
        connection.status, connection.lease_id = "running", "lease"
        db.add(MailFolder(connection_id="alice", remote_id="inbox")); db.commit()
    monkeypatch.setattr(sync, "graph_get", lambda *a: {"value": [{"id": "m1", "subject": "Exam", "body": {"content": "Friday"}}], "@odata.deltaLink": sync.GRAPH + "/me/mailFolders/inbox/messages/delta"})
    def classify(email):
        assert client.delete("/api/outlook/connection").status_code == 200
        return EmailClassification(None, {}, None, None, None, None, ("test",))
    monkeypatch.setattr(sync, "_classifier", SimpleNamespace(classify=classify))
    sync.work_one_page("alice", "lease")
    with factory() as db:
        assert not db.scalars(select(MailItem)).all()


def test_complete_long_cleaned_body_reaches_classifier_storage_and_api(world, monkeypatch):
    client, factory, _ = world
    body = "Course reference material. " * 2000 + "FINAL DEADLINE: Friday."
    with factory() as db:
        connection = db.get(MailConnection, "alice")
        connection.status, connection.lease_id = "running", "lease"
        db.add(MailFolder(connection_id="alice", remote_id="inbox"))
        db.commit()
    monkeypatch.setattr(sync, "graph_get", lambda *a: {"value": [{"id": "long", "subject": "Course", "body": {"content": body}}], "@odata.deltaLink": sync.GRAPH + "/me/mailFolders/inbox/messages/delta"})
    def classify(email):
        assert email.body == body
        return EmailClassification(None, {}, None, None, None, None, ("test",))
    monkeypatch.setattr(sync, "_classifier", SimpleNamespace(classify=classify))
    sync.work_one_page("alice", "lease")
    assert client.get("/api/outlook/messages").json()["items"][0]["excerpt"] == body


def test_search_sort_followup_preview_and_private_detail(world):
    client, factory, _ = world
    first = insert_item(factory, due_date="2026-10-02", classification=json.dumps({"category": "coursework"}))
    second = insert_item(factory, due_date="2026-10-01")
    other = insert_item(factory, "bob")
    with factory() as db:
        db.get(MailItem, first).excerpt = "Course material. " * 100 + "unique tail 100%"
        db.commit()
    page = client.get("/api/outlook/messages", params={"q": "unique tail", "category": "coursework", "preview": True}).json()
    assert [item["id"] for item in page["items"]] == [first]
    assert len(page["items"][0]["excerpt"]) == 240
    assert client.get(f"/api/outlook/messages/{first}").json()["excerpt"].endswith("unique tail 100%")
    assert client.get(f"/api/outlook/messages/{other}").status_code == 404
    assert client.get("/api/outlook/messages", params={"q": "%"}).json()["total"] == 1
    assert [item["id"] for item in client.get("/api/outlook/messages?view=followup&sort=due").json()["items"]] == [second, first]


def test_bulk_edits_are_atomic_and_account_scoped(world):
    client, factory, _ = world
    first, second, other = insert_item(factory), insert_item(factory), insert_item(factory, "bob")
    path = "/api/outlook/messages/bulk"
    assert client.post(path, json={"ids": [first, other], "changes": {"pinned": True}}).status_code == 404
    with factory() as db:
        assert not db.get(MailItem, first).pinned
    assert client.post(path, headers={"Origin": "https://evil.test"}, json={"ids": [first], "changes": {"dismissed": True}}).status_code == 403
    assert client.post(path, json={"ids": [first, second], "changes": {"reviewed": True, "dismissed": True}}).json() == {"updated": 2}
    assert client.get("/api/outlook/messages?view=dismissed").json()["total"] == 2
    assert client.post(path, json={"ids": [first, second], "changes": {"dismissed": False}}).status_code == 200
    assert client.get("/api/outlook/messages?view=review").json()["total"] == 0




def test_expired_session_rejected(world):
    client, factory, _ = world
    with factory() as db:
        db.get(MailSession, auth.digest("alice-cookie")).expires = 0
        db.commit()
    assert client.get("/api/outlook/messages").status_code == 401


def test_429_keeps_cursor_and_respects_retry_after(world, monkeypatch):
    _, factory, _ = world
    cursor = sync.GRAPH + "/me/mailFolders/inbox/messages/delta?$deltatoken=old"
    with factory() as db:
        row = db.get(MailConnection, "alice")
        row.status, row.lease_id = "running", "lease"
        db.add(MailFolder(connection_id="alice", remote_id="inbox", cursor=cursor)); db.commit()
    def throttled(*args): raise sync.GraphError(429, 180)
    monkeypatch.setattr(sync, "graph_get", throttled)
    start = time.time()
    sync.work_one_page("alice", "lease")
    with factory() as db:
        row = db.get(MailConnection, "alice")
        assert row.status == "error" and row.next_sync >= start + 180
        assert db.scalar(select(MailFolder)).cursor == cursor


def test_410_rebuild_removes_stale_baseline(world, monkeypatch):
    _, factory, _ = world
    insert_item(factory)
    with factory() as db:
        row = db.get(MailConnection, "alice")
        row.status, row.lease_id = "running", "lease"
        db.add(MailFolder(connection_id="alice", remote_id="inbox", cursor=sync.GRAPH + "/me/mailFolders/inbox/messages/delta")); db.commit()
    def reset(*args): raise sync.GraphError(410)
    monkeypatch.setattr(sync, "graph_get", reset)
    sync.work_one_page("alice", "lease")
    with factory() as db:
        assert db.scalar(select(MailFolder)).cursor == ""
        db.get(MailConnection, "alice").lease_id = "lease"; db.commit()
    monkeypatch.setattr(sync, "graph_get", lambda *a: {"value": [], "@odata.deltaLink": sync.GRAPH + "/me/mailFolders/inbox/messages/delta?$deltatoken=new"})
    sync.work_one_page("alice", "lease")
    with factory() as db:
        assert not db.scalars(select(MailItem)).all()


def test_nested_folder_discovery_is_durable(world, monkeypatch):
    _, factory, _ = world
    with factory() as db:
        row = db.get(MailConnection, "alice")
        row.status, row.lease_id, row.folder_scan_url = "running", "lease", sync.ROOT_FOLDERS
        db.commit()
    monkeypatch.setattr(sync, "graph_get", lambda *a: {"value": [{"id": "parent", "childFolderCount": 1}]})
    sync.work_one_page("alice", "lease")
    with factory() as db:
        row = db.get(MailConnection, "alice")
        assert "/parent/childFolders" in row.folder_scan_url
        row.lease_id = "lease"; db.commit()
    monkeypatch.setattr(sync, "graph_get", lambda *a: {"value": [{"id": "nested", "childFolderCount": 0}]})
    sync.work_one_page("alice", "lease")
    with factory() as db:
        assert {folder.remote_id for folder in db.scalars(select(MailFolder)).all()} == {"parent", "nested"}
        assert db.get(MailConnection, "alice").folder_scan_url == ""


def test_jev_sees_synced_mail_only_after_opt_in(world, monkeypatch):
    client, factory, _ = world
    monkeypatch.setenv("TYPESAFE_AI_API_KEY", "test-jev-key")
    sent = []
    monkeypatch.setattr(sync, "observe_independently", lambda items, purpose: sent.append((list(items), purpose)))
    def page(message_id, subject):
        return {"value": [{"id": message_id, "subject": subject, "body": {"content": "Due Friday"}}],
                "@odata.deltaLink": sync.GRAPH + "/me/mailFolders/inbox/messages/delta"}
    def run(message_id, subject):
        with factory() as db:
            connection = db.get(MailConnection, "alice")
            connection.status, connection.lease_id = "running", "lease"
            if not db.scalars(select(MailFolder)).first():
                db.add(MailFolder(connection_id="alice", remote_id="inbox"))
            db.execute(MailFolder.__table__.update().values(completed=False, cursor="", next_page=""))
            db.commit()
        monkeypatch.setattr(sync, "graph_get", lambda *a: page(message_id, subject))
        sync.work_one_page("alice", "lease")

    status = client.get("/api/outlook/status").json()
    assert status["jev_available"] is True and status["jev_access"] is False
    run("m1", "Exam")
    assert sent == []  # off by default

    assert client.patch("/api/outlook/jev-access", json={"accepted": True}).json() == {"jev_access": True}
    run("m2", "Lab report")
    assert len(sent) == 1
    items, purpose = sent[0]
    assert purpose == "outlook_ingestion" and [(i.entity_id, i.title) for i in items] == [("m2", "Lab report")]
    assert "Due Friday" in items[0].text

    run("m2", "Lab report")  # unchanged content is not re-sent
    assert len(sent) == 1

    assert client.delete("/api/outlook/connection").status_code == 200
    with factory() as db:
        assert db.get(MailConnection, "alice").jev_access is False


def test_jev_opt_in_hidden_without_key(world, monkeypatch):
    client, _, _ = world
    monkeypatch.delenv("TYPESAFE_AI_API_KEY", raising=False)
    assert client.get("/api/outlook/status").json()["jev_available"] is False
