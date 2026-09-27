from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import time
from urllib.parse import quote, unquote, urlparse
import uuid

import httpx
from sqlalchemy import delete, or_, select, update

from ..database import SessionLocal
from ..email_classifier import ClassifierUnavailable, EmailClassifier, EmailInput
from ..email_cleaning import clean_email_body
from ..sources.pdf_text import redact
from .auth import digest, token_for, TOKEN_TENANT
from .models import MailConnection, MailFolder, MailItem
from . import desktop

GRAPH = "https://graph.microsoft.com/v1.0"
ROOT_FOLDERS = GRAPH + "/me/mailFolders?$top=100&includeHiddenFolders=true"
_classifier: EmailClassifier | None = None


class GraphError(Exception):
    def __init__(self, status: int, retry: int = 60):
        self.status, self.retry = status, max(15, min(retry, 3600))


def valid_graph_url(url: str, account_id: str) -> bool:
    parsed = urlparse(url)
    path = unquote(parsed.path)
    return (parsed.scheme == "https" and parsed.netloc == "graph.microsoft.com"
            and not parsed.fragment and "/../" not in path and "\\" not in path
            and any(path == prefix or path.startswith(prefix + "/") for prefix in (
                "/v1.0/me/mailFolders", f"/v1.0/users/{account_id}/mailFolders")))


def graph_get(url: str, token: str, account_id: str) -> dict:
    if not valid_graph_url(url, account_id):
        raise GraphError(400)
    with httpx.Client(timeout=25, follow_redirects=False) as client:
        with client.stream("GET", url, headers={
            "Authorization": f"Bearer {token}",
            "Prefer": 'outlook.body-content-type="text", IdType="ImmutableId"',
        }) as response:
            if response.status_code != 200:
                retry = response.headers.get("Retry-After", "60")
                raise GraphError(response.status_code, int(retry) if retry.isdigit() else 60)
            chunks, size = [], 0
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > 8_000_000:
                    raise GraphError(413)
                chunks.append(chunk)
    payload = json.loads(b"".join(chunks))
    if not isinstance(payload, dict) or not isinstance(payload.get("value"), list):
        raise GraphError(502)
    return payload


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"br", "p", "div", "li"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def normalize(message: dict) -> tuple[str, str]:
    subject = redact(str(message.get("subject") or "(No subject)"))[:300]
    body = message.get("body") or {}
    text = str(body.get("content") or "")
    if body.get("contentType", "").lower() == "html":
        parser = PlainText()
        parser.feed(text)
        text = " ".join(parser.parts)
    return subject, redact(clean_email_body(text))


def source_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme == "https" and parsed.hostname in {"outlook.office.com", "outlook.office365.com", "outlook.live.com"} and not parsed.username:
        return value
    return ""


def lease_valid(db, connection_id, generation, lease):
    # Every write, including after model inference, must survive a disconnect race.
    return db.execute(update(MailConnection).where(
        MailConnection.id == connection_id, MailConnection.connected.is_(True),
        MailConnection.generation == generation, MailConnection.lease_id == lease,
    ).values(lease_until=time.time() + 600)).rowcount == 1


def work_one_page(connection_id: str, lease: str) -> None:
    global _classifier
    with SessionLocal() as db:
        connection = db.get(MailConnection, connection_id)
        if not connection or connection.lease_id != lease or not connection.connected:
            return
        generation = connection.generation
        try:
            local = connection.tenant == desktop.TENANT
            if local and not desktop.enabled():
                return
            token, cache = ("", "") if local else token_for(connection)
            def fetch(url, token, account_id):
                if local:
                    def known(remote):
                        return db.scalar(select(MailItem.content_hash).where(MailItem.connection_id == connection_id, MailItem.remote_id == remote, MailItem.removed.is_(False)))
                    return desktop.page(url, account_id, known)
                return graph_get(url, token, account_id)
            if not lease_valid(db, connection_id, generation, lease):
                return
            connection.token_cache = cache
            db.commit()
            queue = json.loads(connection.folders_json)
            if connection.folder_scan_url:
                page = fetch(connection.folder_scan_url, token, connection.account_id)
                if not lease_valid(db, connection_id, generation, lease):
                    return
                for row in page["value"]:
                    remote = str(row["id"])
                    folder = db.scalar(select(MailFolder).where(MailFolder.connection_id == connection_id, MailFolder.remote_id == remote))
                    if folder is None:
                        db.add(MailFolder(connection_id=connection_id, remote_id=remote))
                    if row.get("childFolderCount", 0):
                        url = GRAPH + f"/me/mailFolders/{quote(remote, safe='')}/childFolders?$top=100&includeHiddenFolders=true"
                        if url not in queue:
                            queue.append(url)
                next_url = page.get("@odata.nextLink") or (queue.pop(0) if queue else "")
                connection.folder_scan_url = next_url
                connection.folders_json = json.dumps(queue)
                db.commit()
            else:
                folder = db.scalar(select(MailFolder).where(MailFolder.connection_id == connection_id, MailFolder.completed.is_(False)).order_by(MailFolder.id))
                if folder is None:
                    if lease_valid(db, connection_id, generation, lease):
                        connection.status = "idle"
                        connection.last_sync = time.time()
                        connection.next_sync = time.time() + 900
                        connection.lease_until = 0
                        connection.lease_id = ""
                        db.commit()
                    return
                url = folder.next_page or folder.cursor or (GRAPH + f"/me/mailFolders/{quote(folder.remote_id, safe='')}/messages/delta?$top=20&$select=id,subject,from,body,receivedDateTime,webLink")
                try:
                    page = fetch(url, token, connection.account_id)
                except GraphError as error:
                    if error.status in {404, 410}:
                        if not lease_valid(db, connection_id, generation, lease):
                            return
                        if error.status == 404:
                            db.execute(delete(MailItem).where(MailItem.connection_id == connection_id, MailItem.folder_id == folder.remote_id))
                            db.delete(folder)
                        else:
                            folder.cursor = folder.next_page = ""
                            folder.rebuild_id = str(uuid.uuid4())
                        connection.lease_id, connection.lease_until = "", 0
                        db.commit()
                        return
                    raise
                if not (page.get("@odata.nextLink") or page.get("@odata.deltaLink")):
                    raise GraphError(502)
                for message in page["value"]:
                    remote = str(message["id"])
                    item = db.scalar(select(MailItem).where(MailItem.connection_id == connection_id, MailItem.remote_id == remote))
                    if message.get("@unchanged") and item is not None:
                        if not lease_valid(db, connection_id, generation, lease):
                            return
                        item.scan_id = folder.rebuild_id
                        db.commit()
                        continue
                    if "@removed" in message:
                        if not lease_valid(db, connection_id, generation, lease):
                            return
                        if item and item.folder_id == folder.remote_id:
                            item.removed = True
                            item.subject = item.excerpt = item.sender = item.web_url = ""
                        db.commit()
                        continue
                    subject, body = normalize(message)
                    fingerprint = message.get("desktopRevision") if local else digest(subject + "\n" + body)
                    result = None
                    if item is None or item.content_hash != fingerprint:
                        if _classifier is None:
                            _classifier = EmailClassifier()
                        result = asdict(_classifier.classify(EmailInput(subject, body)))
                    if not lease_valid(db, connection_id, generation, lease):
                        return
                    if item is None:
                        item = MailItem(connection_id=connection_id, remote_id=remote, folder_id=folder.remote_id,
                                        subject=subject, sender="", excerpt="", received="", web_url="", content_hash="", expires=0)
                        db.add(item)
                    item.folder_id = folder.remote_id
                    item.scan_id = folder.rebuild_id
                    item.removed = False
                    item.subject = subject
                    item.sender = redact(str((message.get("from") or {}).get("emailAddress", {}).get("name") or "Unknown sender"))[:200]
                    # Legacy column name retained for database/API compatibility.
                    item.excerpt = body
                    received = message.get("receivedDateTime")
                    item.received = datetime.fromisoformat(received.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if received else ""
                    item.web_url = source_url(str(message.get("webLink") or ""))
                    item.content_hash = fingerprint
                    if result is not None:
                        item.classification = json.dumps(result)
                        item.reviewed = False
                        item.expires = time.time() + 30 * 86400
                        connection.processed += 1
                    db.commit()
                if not lease_valid(db, connection_id, generation, lease):
                    return
                folder.next_page = page.get("@odata.nextLink", "")
                if not folder.next_page:
                    if not folder.cursor:
                        db.execute(delete(MailItem).where(MailItem.connection_id == connection_id,
                            MailItem.folder_id == folder.remote_id, MailItem.scan_id != folder.rebuild_id))
                    folder.cursor = page["@odata.deltaLink"]
                    folder.completed = True
                db.commit()
            if lease_valid(db, connection_id, generation, lease):
                connection.lease_until = 0
                connection.lease_id = ""
                connection.next_sync = time.time()
                db.commit()
        except Exception as error:
            db.rollback()
            if not lease_valid(db, connection_id, generation, lease):
                return
            connection = db.get(MailConnection, connection_id, populate_existing=True)
            retry = error.retry if isinstance(error, GraphError) else 300
            reconnect = (isinstance(error, ValueError) and str(error) == "reauthorization_required") or (isinstance(error, GraphError) and error.status in {401, 403})
            connection.status = "reconnect" if reconnect else "error"
            connection.error = "Reconnect with a fresh Microsoft Graph token. Your organization must permit Mail.Read access." if reconnect else (
                "Laya is unavailable. Run setup.bat or setup.sh, then retry sync." if isinstance(error, ClassifierUnavailable)
                else "Classic Outlook could not be read. Check its profile, security prompts and organization policy; then retry." if connection.tenant == desktop.TENANT
                else "Sync paused after a provider error. Previous results are preserved; retry later.")
            connection.next_sync = time.time() + retry
            connection.lease_until = 0
            connection.lease_id = ""
            db.commit()


def tick() -> None:
    stamp, lease = time.time(), str(uuid.uuid4())
    with SessionLocal() as db:
        db.execute(delete(MailItem).where(MailItem.expires < stamp))
        row = db.scalar(select(MailConnection).where(
            MailConnection.tenant.in_([desktop.TENANT, TOKEN_TENANT] if desktop.enabled() else [TOKEN_TENANT]),
            MailConnection.connected.is_(True), MailConnection.status != "reconnect",
            MailConnection.next_sync <= stamp, MailConnection.lease_until < stamp,
            or_(MailConnection.auto_sync.is_(True), MailConnection.status.in_(["queued", "running"])),
        ).order_by(MailConnection.next_sync))
        if row is None:
            db.commit()
            return
        claimed = db.execute(update(MailConnection).where(MailConnection.id == row.id, MailConnection.lease_until < stamp)
                             .values(lease_until=stamp + 600, lease_id=lease)).rowcount
        if not claimed:
            db.rollback()
            return
        if row.status in {"idle", "paused", "queued"}:
            db.execute(update(MailFolder).where(MailFolder.connection_id == row.id).values(completed=False))
            if row.tenant == desktop.TENANT:
                db.execute(update(MailFolder).where(MailFolder.connection_id == row.id).values(cursor="", next_page="", rebuild_id=str(uuid.uuid4())))
            row.folder_scan_url = ROOT_FOLDERS
            row.folders_json = "[]"
            row.processed = 0
        row.status, row.error = "running", ""
        connection_id = row.id
        db.commit()
    work_one_page(connection_id, lease)


async def sync_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            # Durable lease expires after a crash; don't log secrets/provider payloads.
            pass
        await asyncio.sleep(2)
