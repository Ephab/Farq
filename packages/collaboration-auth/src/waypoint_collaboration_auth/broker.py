"""Configuration, safe errors and OS-vault storage shared by the device broker and the local router."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
import sys
from urllib.parse import urlsplit


class AuthError(Exception):
    """Safe user-facing error with no credential or server-response details."""


@dataclass(frozen=True)
class Config:
    api_origin: str
    origins: tuple[str, ...]
    # Allows an http loopback server address, for running the shared server on this same computer while developing.
    development: bool = False

    def __post_init__(self):
        for kind, value in [("server", self.api_origin)] + [("origin", item) for item in self.origins]:
            url = urlsplit(value)
            # Origins are only compared with the browser's Origin header, so the app's own http loopback address is fine.
            loopback = url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"}
            local = loopback and (self.development or kind == "origin")
            if (url.scheme != "https" and not local) or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("Use an HTTPS server address (http only for loopback in development)")
        if urlsplit(self.api_origin).path not in {"", "/"}:
            raise ValueError("The server address must not have a path")

    @classmethod
    def from_env(cls):
        if not os.getenv("WAYPOINT_COLLAB_URL"):
            return None
        return cls(api_origin=os.environ["WAYPOINT_COLLAB_URL"].rstrip("/"),
                   origins=tuple(item.strip() for item in os.getenv("WAYPOINT_COLLAB_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if item.strip()),
                   development=os.getenv("WAYPOINT_COLLAB_DEVELOPMENT") == "true")


class CredentialStore:
    def __init__(self, config: Config):
        # Never fall back to a plaintext keyring backend.
        if sys.platform == "win32":
            from keyring.backends.Windows import WinVaultKeyring
            self.backend = WinVaultKeyring()
        elif sys.platform == "darwin":
            from keyring.backends.macOS import Keyring
            self.backend = Keyring()
        else:
            from keyring.backends.SecretService import Keyring
            self.backend = Keyring()
        # The empty issuer and fixed client name are kept so keys saved by earlier versions stay readable.
        self.service = "Waypoint collaboration " + hashlib.sha256(f"|waypoint-desktop|{config.api_origin}".encode()).hexdigest()[:24]

    def get(self, session: str):
        raw = self.backend.get_password(self.service, session)
        return json.loads(raw) if raw else None

    def put(self, session: str, value: dict):
        self.backend.set_password(self.service, session, json.dumps(value))

    def delete(self, session: str):
        if self.backend.get_password(self.service, session) is not None:
            self.backend.delete_password(self.service, session)
