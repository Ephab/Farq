"""Idempotent local configuration. Never prints credentials or reads a mailbox."""
from __future__ import annotations

import base64
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.api.app.outlook.platform import classic_outlook_supported

OBSOLETE_KEYS = {"OUTLOOK_PROVIDER", "MICROSOFT_CLIENT_ID", "MICROSOFT_TENANT_ID",
                 "MICROSOFT_CLIENT_SECRET", "MICROSOFT_REDIRECT_URI", "OUTLOOK_CLIENT_ID", "OUTLOOK_TENANT"}


def read_env(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and key and not key.startswith("#"):
            values[key.strip()] = value.strip()
    return values


def configure_env(root: Path = ROOT, supported: bool | None = None) -> dict[str, str]:
    path = root / ".env"
    text = (path if path.exists() else root / ".env.example").read_text(encoding="utf-8-sig")
    values = read_env(path) if path.exists() else read_env(root / ".env.example")
    updates = {}
    for name in ("HERMES_API_KEY", "WAYPOINT_INTERNAL_TOKEN"):
        if not values.get(name) or values.get(name) == "waypoint-internal-dev":
            updates[name] = secrets.token_hex(32)
    if not values.get("WAYPOINT_TOKEN_ENCRYPTION_KEY"):
        updates["WAYPOINT_TOKEN_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
    else:
        try:
            if len(base64.b64decode(values["WAYPOINT_TOKEN_ENCRYPTION_KEY"], altchars=b"-_", validate=True)) != 32:
                raise ValueError()
        except ValueError:
            raise RuntimeError("WAYPOINT_TOKEN_ENCRYPTION_KEY is invalid; preserve or restore the existing valid encryption key.") from None
    if (classic_outlook_supported() if supported is None else supported) and not values.get("OUTLOOK_LOCAL_TOKEN"):
        updates["OUTLOOK_LOCAL_TOKEN"] = secrets.token_hex(32)
    defaults = {"OUTLOOK_APP_ORIGIN": "http://localhost:5173", "OUTLOOK_SYNC_ENABLED": "true",
                "HERMES_URL": "http://127.0.0.1:8642"}
    for name, value in defaults.items():
        if not values.get(name):
            updates[name] = value
    # Email requests always use the Coach gateway; migrate the retired split URL.
    updates["HERMES_EMAIL_URL"] = values.get("HERMES_URL") or defaults["HERMES_URL"]
    lines, seen = [], set()
    for line in text.splitlines():
        key, separator, _ = line.strip().partition("=")
        key = key.strip()
        if separator and key in OBSOLETE_KEYS:
            continue
        if separator and key in updates:
            if key not in seen:
                lines.append(f"{key}={updates[key]}")
                seen.add(key)
        else:
            lines.append(line)
    lines.extend(f"{key}={value}" for key, value in updates.items() if key not in seen)
    output = "\n".join(lines) + "\n"
    if not path.exists() or output != text:
        # Named exclusively, same-directory temporary file for an atomic replace.
        temporary = root / (".env-" + secrets.token_hex(8) + ".tmp")
        try:
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(output)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
    return read_env(path)
