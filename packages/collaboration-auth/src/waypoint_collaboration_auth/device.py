"""Silent shared account for this computer: a key pair in the OS vault, registered once, no login page.

`DeviceBroker.token(user)` returns
`{"access_token", "expires_at", "account": {"id", "display_name"}}` and is called from the local API only. The private
key is generated here, stored only in the OS credential vault (never in the browser, a file or a log), and used to sign
the server's short-lived challenge. One key per local Waypoint student, so two students on one computer stay separate.
Forgetting the key forgets the account: there is no recovery path in this first version.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import threading
import time

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .broker import AuthError, Config, CredentialStore

CLIENT_VERSION = "0.1.0"
TOKEN_PURPOSE = b"waypoint-device-token\n"
MAX_POW_TRIES = 60_000_000


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def leading_zero_bits(digest: bytes) -> int:
    count = 0
    for byte in digest:
        if byte == 0:
            count += 8
            continue
        return count + 8 - byte.bit_length()
    return count


def solve_pow(challenge: str, public_key: str, bits: int) -> str:
    for counter in range(MAX_POW_TRIES):
        if leading_zero_bits(hashlib.sha256(f"{challenge}:{public_key}:{counter}".encode()).digest()) >= bits:
            return str(counter)
    raise AuthError("Could not prepare your shared account")


class DeviceBroker:
    def __init__(self, config: Config, store=None, client=None):
        self.config = config
        self.store = store if store is not None else CredentialStore(config)
        self.client = client if client is not None else httpx.Client(timeout=20, follow_redirects=False)
        self.lock = threading.RLock()
        self.cache: dict[str, dict] = {}
        self.names: dict[str, str] = {}

    def remember(self, user: str, display_name: str) -> None:
        """The name to register the account with (the student's own Waypoint name); only used the first time."""
        self.names[user] = (display_name or "Student").strip()[:120] or "Student"

    def _url(self, path: str) -> str:
        return self.config.api_origin + path

    def _call(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            return self.client.request(method, self._url(path), headers={"X-Waypoint-Client-Version": CLIENT_VERSION}, **kwargs)
        except httpx.HTTPError:
            raise AuthError("Could not reach the shared service") from None

    def _key(self, user: str) -> tuple[Ed25519PrivateKey, dict]:
        saved = self.store.get("device:" + user)
        if saved and "private_key" in saved:
            return Ed25519PrivateKey.from_private_bytes(unb64(saved["private_key"])), saved
        key = Ed25519PrivateKey.generate()
        saved = {"private_key": b64(key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()))}
        self.store.put("device:" + user, saved)  # keep the key before anything is registered, so it is never lost
        return key, saved

    @staticmethod
    def _public(key: Ed25519PrivateKey) -> str:
        return b64(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))

    def _register(self, user: str, key: Ed25519PrivateKey, saved: dict) -> dict:
        public = self._public(key)
        challenge = self._call("GET", "/v1/auth/pow")
        if challenge.status_code != 200:
            raise AuthError("The shared service is not ready for new accounts")
        details = challenge.json()
        nonce = solve_pow(details["challenge"], public, int(details["bits"]))
        answer = self._call("POST", "/v1/auth/register", json={"public_key": public, "display_name": self.names.get(user, "Student"),
                                                                "challenge": details["challenge"], "nonce": nonce})
        if answer.status_code == 429:
            raise AuthError("The shared service has reached its daily limit for new accounts; try again tomorrow")
        if answer.status_code != 200:
            raise AuthError("Could not create your shared account")
        saved = {**saved, "account_id": answer.json()["account_id"]}
        self.store.put("device:" + user, saved)
        return saved

    def _token(self, key: Ed25519PrivateKey) -> httpx.Response:
        public = self._public(key)
        challenge = self._call("POST", "/v1/auth/challenge", json={"public_key": public})
        if challenge.status_code != 200:
            raise AuthError("Could not reach the shared service")
        nonce = challenge.json()["nonce"]
        return self._call("POST", "/v1/auth/token", json={"public_key": public, "nonce": nonce,
                                                          "signature": b64(key.sign(TOKEN_PURPOSE + nonce.encode()))})

    def token(self, user: str):
        with self.lock:
            current = self.cache.get(user)
            if current and current["expires_at"] > time.time() + 30:
                return current
            try:
                key, saved = self._key(user)
                if "account_id" not in saved:
                    saved = self._register(user, key, saved)
                answer = self._token(key)
                if answer.status_code == 401:
                    # The server does not know this key (for example its database was reset): register it again once.
                    saved = self._register(user, key, {k: v for k, v in saved.items() if k != "account_id"})
                    answer = self._token(key)
                if answer.status_code == 403:
                    raise AuthError("This shared account has been disabled")
                if answer.status_code == 426:
                    raise AuthError("Update Waypoint to keep using collaboration")
                if answer.status_code != 200:
                    raise AuthError("Could not sign in to the shared service")
                value = answer.json()
                if value["account"]["id"] != saved.get("account_id"):
                    self.store.put("device:" + user, {**saved, "account_id": value["account"]["id"]})
                self.cache[user] = {"access_token": value["access_token"], "expires_at": value["expires_at"], "account": value["account"]}
                return self.cache[user]
            except AuthError:
                raise
            except Exception as error:  # never leak details or keys
                logging.getLogger(__name__).warning("Shared account setup failed (%s)", type(error).__name__)
                raise AuthError("Could not set up your shared account") from None

    def consented(self, user: str) -> bool:
        """Has this local student confirmed connecting to this server address? Stored in the vault beside the key."""
        try:
            return bool((self.store.get("consent:" + user) or {}).get("at"))
        except Exception:
            return False

    def consent(self, user: str) -> None:
        self.store.put("consent:" + user, {"at": int(time.time())})

    def withdraw(self, user: str) -> None:
        with self.lock:
            self.cache.pop(user, None)
            self.store.delete("consent:" + user)

    def logout(self, user: str) -> bool:
        """Forget the cached token only. The key (and so the account) stays in the vault."""
        with self.lock:
            self.cache.pop(user, None)
        return True

    def forget_account(self, user: str) -> None:
        """Delete this computer's key for `user`: the shared account can never be used again from here."""
        with self.lock:
            self.cache.pop(user, None)
            self.store.delete("device:" + user)

    def close(self) -> None:
        self.client.close()
