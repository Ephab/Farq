"""Read-only classic Outlook adapter. COM objects never leave their owning thread."""
from contextlib import contextmanager
from datetime import timezone
import json
import os
import hashlib
import hmac
import sys
from urllib.parse import unquote, urlparse

from fastapi import HTTPException
from ..email_cleaning import CLEANING_VERSION

TENANT = "local-outlook-desktop"
from .platform import classic_outlook_supported


def enabled():
    return classic_outlook_supported() and len(os.getenv("OUTLOOK_LOCAL_TOKEN", "")) >= 32


def origin():
    from .auth import origin as app_origin
    value = app_origin()
    parsed = urlparse(value)
    if sys.platform != "win32" or parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise HTTPException(503, "Classic Outlook requires native Windows and a localhost app origin.")
    return value


def consent_digest(value):
    key = os.getenv("OUTLOOK_LOCAL_TOKEN", "")
    if len(key) < 32:
        raise HTTPException(503, "Run setup.bat to enable classic Outlook on this computer.")
    return hmac.new(key.encode(), value.encode(), hashlib.sha256).hexdigest()


def require_local(request):
    origin()
    if not request.client or request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        raise HTTPException(403, "Classic Outlook is available only on this computer.")
    if request.url.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise HTTPException(403, "Classic Outlook requires a localhost request host.")


@contextmanager
def mailbox(expected_store=None):
    import pythoncom
    import win32com.client
    pythoncom.CoInitialize()
    application = namespace = store = None
    try:
        application = win32com.client.Dispatch("Outlook.Application")
        namespace = application.GetNamespace("MAPI")
        store = namespace.DefaultStore
        if expected_store and store.StoreID != expected_store:
            raise RuntimeError("Outlook's default mailbox changed. Disconnect and connect again.")
        yield namespace, store
    finally:
        store = namespace = application = None
        pythoncom.CoUninitialize()


def profile():
    with mailbox() as resources:
        result = str(resources[1].StoreID), str(resources[1].DisplayName)[:200]
        del resources
        return result


def page(url, store_id, known):
    """Return Graph-shaped pages to reuse the private cache and worker lease logic.

    Snapshot only EntryIDs using an Outlook Table, never list(Items). Pending IDs
    are persisted in the existing next-page cursor; body reads are capped at 20.
    """
    with mailbox(store_id) as resources:
        result = _page(resources[0], resources[1], url, store_id, known)
        del resources
        return result


def missing_item(error):
    # DISP_E_EXCEPTION may wrap MAPI_E_NOT_FOUND in EXCEPINFO.
    info = getattr(error, "excepinfo", None)
    return getattr(error, "hresult", None) == -2147221233 or bool(info and info[-1] == -2147221233)


def _page(namespace, store, url, store_id, known):
    if "/messages/delta" not in url and not url.startswith("desktop:"):
        pending = [store.GetRootFolder()]
        rows = []
        while pending:
            folder = pending.pop()
            if len(rows) >= 2000:
                raise RuntimeError("Mailbox folder limit reached")
            if folder.DefaultItemType == 0:
                rows.append({"id": str(folder.EntryID), "childFolderCount": 0})
            for index in range(1, folder.Folders.Count + 1):
                pending.append(folder.Folders.Item(index))
        return {"value": rows}
    if url.startswith("desktop:"):
        state = json.loads(url[len("desktop:"):])
        folder_id, ids = state["folder"], state["ids"]
    else:
        folder_id = unquote(url.split("/mailFolders/", 1)[1].split("/messages/", 1)[0])
        try:
            folder = namespace.GetFolderFromID(folder_id, store_id)
        except Exception as error:
            if missing_item(error):
                from .sync import GraphError
                raise GraphError(404) from None
            raise
        table = folder.GetTable()
        table.Columns.RemoveAll()
        table.Columns.Add("EntryID")
        table.Columns.Add("MessageClass")
        table.Columns.Add("ReceivedTime")
        table.Sort("ReceivedTime", True)
        ids = []
        while not table.EndOfTable:
            row = table.GetNextRow()
            if str(row.Item("MessageClass")).startswith("IPM.Note"):
                ids.append(str(row.Item("EntryID")))
            if len(ids) > 100000:
                raise RuntimeError("Mailbox folder message limit reached")
    rows = []
    for entry_id in ids[:20]:
        # A provider failure preserves the cursor for retry, never silently drops mail.
        try:
            message = namespace.GetItemFromID(entry_id, store_id)
        except Exception as error:
            if missing_item(error):
                rows.append({"id": entry_id, "@removed": {}})
                continue
            raise
        if message.Class != 43:
            continue
        revision = str(message.LastModificationTime)
        fingerprint = "desktop:" + CLEANING_VERSION + ":" + revision
        if known(entry_id) == fingerprint:
            rows.append({"id": entry_id, "@unchanged": True})
            continue
        rows.append({"id": entry_id, "subject": str(message.Subject or ""),
                     "body": {"contentType": "text", "content": str(message.Body or "")},
                     "from": {"emailAddress": {"name": str(message.SenderName or "")}},
                     "receivedDateTime": message.ReceivedTime.astimezone(timezone.utc).isoformat(),
                     "desktopRevision": fingerprint})
    remaining = ids[20:]
    return {"value": rows, **({"@odata.nextLink": "desktop:" + json.dumps({"folder": folder_id, "ids": remaining})}
                              if remaining else {"@odata.deltaLink": "desktop:complete"})}
