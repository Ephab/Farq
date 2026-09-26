from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
import json

import pytest
from sqlalchemy import select

from app.outlook import auth, desktop, sync
from app.email_cleaning import CLEANING_VERSION
from app.outlook.models import MailConnection, MailItem
from test_outlook import world, insert_item


class Table:
    def __init__(self, count):
        self.ids = list(range(count))
        self.Columns = SimpleNamespace(RemoveAll=lambda: None, Add=lambda name: None)
    @property
    def EndOfTable(self):
        return not self.ids
    def Sort(self, column, descending):
        assert (column, descending) == ("ReceivedTime", True)
    def GetNextRow(self):
        index = self.ids.pop(0)
        return SimpleNamespace(Item=lambda name: "IPM.Note" if name == "MessageClass" else str(index))


def test_bounded_body_reads_and_durable_snapshot(monkeypatch):
    reads = []
    def get_item(entry, store):
        reads.append(entry)
        return SimpleNamespace(Class=43, LastModificationTime="revision", Subject="Course update", Body="Assignment due",
                               SenderName="Professor", ReceivedTime=datetime.now(timezone.utc))
    namespace = SimpleNamespace(GetFolderFromID=lambda *args: SimpleNamespace(GetTable=lambda: Table(45)), GetItemFromID=get_item)
    @contextmanager
    def mailbox(store):
        yield namespace, None
    monkeypatch.setattr(desktop, "mailbox", mailbox)
    first = desktop.page(sync.GRAPH + "/me/mailFolders/inbox/messages/delta", "store", lambda _: None)
    assert len(reads) == len(first["value"]) == 20
    second = desktop.page(first["@odata.nextLink"], "store", lambda _: None)
    third = desktop.page(second["@odata.nextLink"], "store", lambda _: None)
    assert len(reads) == len(set(reads)) == 45
    assert third["@odata.deltaLink"] == "desktop:complete"


def test_unchanged_mail_does_not_read_body_and_deleted_ids_continue():
    class Unchanged:
        Class = 43
        LastModificationTime = "revision"
        @property
        def Body(self):
            raise AssertionError("Body should not be read")
    class Missing(Exception):
        hresult = -2147221233
    def item(entry, store):
        if entry == "deleted":
            raise Missing()
        return Unchanged()
    page = desktop._page(SimpleNamespace(GetItemFromID=item), None,
                         'desktop:' + json.dumps({"folder": "inbox", "ids": ["same", "deleted"]}),
                         "store", lambda _: "desktop:" + CLEANING_VERSION + ":revision")
    assert page["value"] == [{"id": "same", "@unchanged": True}, {"id": "deleted", "@removed": {}}]


def test_desktop_consent_pairing_and_private_session(world, monkeypatch):
    client, factory, _ = world
    monkeypatch.setenv("OUTLOOK_PROVIDER", "desktop")
    monkeypatch.setattr(desktop, "origin", lambda: "http://localhost:5173")
    monkeypatch.setattr(desktop, "pairing_key", lambda: "local-secret")
    calls = []
    def profile():
        calls.append(True)
        return "store", "University"
    monkeypatch.setattr(desktop, "profile", profile)
    client.cookies.clear()
    assert client.get("/api/outlook/status").json()["provider"] == "desktop"
    assert client.post("/api/outlook/desktop/connect", json={"pairing_code": "wrong", "accepted": True}).status_code == 403
    assert client.post("/api/outlook/desktop/connect", json={"pairing_code": "local-secret", "accepted": False}).status_code == 403
    assert calls == []
    assert client.post("/api/outlook/desktop/connect", json={"pairing_code": "local-secret", "accepted": True}).status_code == 200
    assert client.get("/api/outlook/status").json()["connected"]
    with factory() as db:
        connection = db.scalar(select(MailConnection).where(MailConnection.tenant == desktop.TENANT))
        assert connection.token_cache == ""
        connection_id = connection.id
    insert_item(factory, connection_id)
    assert client.get("/api/outlook/messages").json()["total"] == 1
    assert client.delete("/api/outlook/connection").status_code == 200
    assert client.get("/api/outlook/messages").status_code == 401


def test_desktop_does_not_allow_remote_or_non_windows(monkeypatch):
    monkeypatch.setattr(desktop.sys, "platform", "linux")
    with pytest.raises(Exception, match="native Windows"):
        desktop.origin()
    monkeypatch.setattr(desktop, "origin", lambda: "http://localhost:5173")
    with pytest.raises(Exception, match="only on this computer"):
        desktop.require_local(SimpleNamespace(client=SimpleNamespace(host="10.0.0.2")))


def test_desktop_worker_uses_local_adapter_and_deduplicates(world, monkeypatch):
    client, factory, _ = world
    monkeypatch.setenv("OUTLOOK_PROVIDER", "desktop")
    with factory() as db:
        row = db.get(MailConnection, "alice")
        row.tenant = desktop.TENANT
        row.status = "queued"
        db.get(MailConnection, "bob").connected = False
        db.commit()
    def page(url, store, known):
        if "messages" not in url:
            return {"value": [{"id": "inbox"}]}
        return {"value": [{"id": "email", "subject": "Class", "body": {"content": "Assignment"},
                           "desktopRevision": "desktop:revision"}], "@odata.deltaLink": "desktop:complete"}
    monkeypatch.setattr(desktop, "page", page)
    monkeypatch.setattr(sync, "token_for", lambda _: pytest.fail("Desktop must not request Microsoft tokens"))
    sync.tick()
    sync.tick()
    with factory() as db:
        item = db.scalar(select(MailItem).where(MailItem.connection_id == "alice"))
        assert item.subject == "Class"
        assert item.content_hash == "desktop:revision"
        assert db.get(MailConnection, "alice").processed == 1
