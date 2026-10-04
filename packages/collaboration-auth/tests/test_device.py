"""The silent device account: key custody, one-time registration, token fetching and the local router in device mode."""
import base64
import hashlib
import json

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest

from waypoint_collaboration_auth.broker import AuthError, Config
from waypoint_collaboration_auth.device import DeviceBroker, TOKEN_PURPOSE, leading_zero_bits
from waypoint_collaboration_auth.router import create_router

API = "https://collab.example"
BITS = 8


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Vault(dict):
    def get(self, key):
        return super().get(key)

    def put(self, key, value):
        self[key] = json.loads(json.dumps(value))

    def delete(self, key):
        self.pop(key, None)


class Server:
    """Just enough of the central device API, verifying real proofs of work and signatures."""

    def __init__(self):
        self.accounts, self.calls, self.names, self.status_override = {}, [], {}, {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body = json.loads(request.content) if request.content else {}
        self.calls.append((request.method, path))
        assert request.headers["x-waypoint-client-version"]
        if path in self.status_override:
            return httpx.Response(self.status_override[path], json={"detail": "x"})
        if path == "/v1/auth/pow":
            return httpx.Response(200, json={"challenge": "abc.999999999999.tag", "bits": BITS})
        if path == "/v1/auth/register":
            digest = hashlib.sha256(f"{body['challenge']}:{body['public_key']}:{body['nonce']}".encode()).digest()
            assert leading_zero_bits(digest) >= BITS, "proof of work not solved"
            assert unb64(body["public_key"]) and len(unb64(body["public_key"])) == 32
            account = self.accounts.setdefault(body["public_key"], f"account-{len(self.accounts) + 1}")
            self.names[account] = body["display_name"]
            return httpx.Response(200, json={"account_id": account, "created": True})
        if path == "/v1/auth/challenge":
            return httpx.Response(200, json={"nonce": f"nonce-{len(self.calls)}.99.mac"})
        if path == "/v1/auth/token":
            if body["public_key"] not in self.accounts:
                return httpx.Response(401, json={"detail": "This device is not registered"})
            Ed25519PublicKey.from_public_bytes(unb64(body["public_key"])).verify(unb64(body["signature"]), TOKEN_PURPOSE + body["nonce"].encode())
            account = self.accounts[body["public_key"]]
            return httpx.Response(200, json={"access_token": "token-" + account, "expires_at": 4_000_000_000,
                                             "account": {"id": account, "display_name": self.names[account]}})
        return httpx.Response(404)


@pytest.fixture
def world():
    server, vault = Server(), Vault()
    config = Config(API, ("http://localhost:5173",))
    client = httpx.Client(transport=httpx.MockTransport(server))
    return server, vault, config, client


def broker(world):
    server, vault, config, client = world
    return DeviceBroker(config, store=vault, client=client)


def test_first_use_creates_a_key_registers_once_and_returns_an_account(world):
    server, vault, *_ = world
    device = broker(world)
    device.remember("student-1", "Rashed Alkhathlan")
    value = device.token("student-1")
    assert value["account"] == {"id": "account-1", "display_name": "Rashed Alkhathlan"} and value["access_token"] == "token-account-1"
    assert [path for _, path in server.calls] == ["/v1/auth/pow", "/v1/auth/register", "/v1/auth/challenge", "/v1/auth/token"]
    saved = vault["device:student-1"]
    assert set(saved) == {"private_key", "account_id"} and saved["account_id"] == "account-1"
    before = len(server.calls)
    assert device.token("student-1") is value and len(server.calls) == before  # cached until shortly before expiry


def test_a_restart_reuses_the_same_key_and_account_without_registering_again(world):
    server, vault, *_ = world
    first = broker(world)
    first.remember("s", "A")
    first.token("s")
    key = vault["device:s"]["private_key"]
    second = broker(world)
    second.remember("s", "A different name")
    value = second.token("s")
    assert vault["device:s"]["private_key"] == key and value["account"]["id"] == "account-1"
    assert [path for _, path in server.calls].count("/v1/auth/register") == 1


def test_local_students_get_separate_accounts(world):
    device = broker(world)
    device.remember("a", "Ann")
    device.remember("b", "Ben")
    assert device.token("a")["account"]["id"] != device.token("b")["account"]["id"]
    assert world[1]["device:a"]["private_key"] != world[1]["device:b"]["private_key"]


def test_an_unknown_key_is_registered_again_once(world):
    server, vault, *_ = world
    device = broker(world)
    device.remember("s", "A")
    device.token("s")
    device.cache.clear()
    server.accounts.clear()  # the server lost its database
    value = device.token("s")
    assert value["account"]["id"] == "account-1" and [path for _, path in server.calls].count("/v1/auth/register") == 2


@pytest.mark.parametrize("status,message", [(403, "disabled"), (426, "Update Waypoint"), (500, "Could not sign in")])
def test_server_refusals_become_safe_messages(world, status, message):
    server, *_ = world
    device = broker(world)
    device.remember("s", "A")
    server.status_override["/v1/auth/token"] = status
    with pytest.raises(AuthError, match=message):
        device.token("s")


def test_registration_limit_and_outages_are_reported_plainly_without_details(world):
    server, vault, config, client = world
    device = broker(world)
    server.status_override["/v1/auth/register"] = 429
    with pytest.raises(AuthError, match="daily limit"):
        device.token("s")
    assert "private_key" in vault["device:s"] and "account_id" not in vault["device:s"]  # the key is kept for the next try
    down = DeviceBroker(config, store=Vault(), client=httpx.Client(transport=httpx.MockTransport(lambda request: (_ for _ in ()).throw(httpx.ConnectError("secret internal detail")))))
    with pytest.raises(AuthError) as error:
        down.token("s")
    assert "secret" not in str(error.value) and str(error.value) == "Could not reach the shared service"


def test_logout_keeps_the_account_but_forgetting_deletes_the_key(world):
    server, vault, *_ = world
    device = broker(world)
    device.remember("s", "A")
    device.token("s")
    assert device.logout("s") is True and "device:s" in vault
    device.token("s")
    assert [path for _, path in server.calls].count("/v1/auth/register") == 1
    device.forget_account("s")
    assert "device:s" not in vault


def test_config_requires_an_https_server_and_only_local_http_origins():
    assert Config(API, ("http://localhost:5173", "http://127.0.0.1:5173")).origins[0] == "http://localhost:5173"
    with pytest.raises(ValueError):
        Config("http://collab.example", ("http://localhost:5173",))
    with pytest.raises(ValueError):
        Config(API, ("http://evil.example",))
    with pytest.raises(ValueError):
        Config(API + "/path", ())
    assert Config("http://127.0.0.1:8100", (), development=True).api_origin == "http://127.0.0.1:8100"
    with pytest.raises(ValueError):
        Config("http://127.0.0.1:8100", ())


def test_config_from_environment(monkeypatch):
    monkeypatch.delenv("WAYPOINT_COLLAB_URL", raising=False)
    assert Config.from_env() is None
    monkeypatch.setenv("WAYPOINT_COLLAB_URL", API + "/")
    monkeypatch.setenv("WAYPOINT_COLLAB_ORIGINS", "http://localhost:5174, http://127.0.0.1:5174")
    config = Config.from_env()
    assert config.api_origin == API and config.origins == ("http://localhost:5174", "http://127.0.0.1:5174")


def app_for(world, local="student-1", name="Ada Lovelace", agreed=True):
    server, vault, config, client = world
    if agreed:
        DeviceBroker(config, store=vault, client=client).consent(local)
    seen = {"calls": 0}

    def identity(request):
        seen["calls"] += 1
        return local, name

    app = FastAPI()
    app.include_router(create_router(config, DeviceBroker(config, store=vault, client=client), identity=identity))
    return TestClient(app, client=("127.0.0.1", 50000)), server, seen


HEADERS = {"Origin": "http://localhost:5173", "X-Waypoint-Collaboration": "1"}


def test_router_gives_the_local_student_a_shared_account_with_no_login_step(world):
    client, server, seen = app_for(world)
    session = client.post("/api/collaboration/auth/session", headers=HEADERS)
    assert session.status_code == 200 and session.json() == {"account": {"id": "account-1", "display_name": "Ada Lovelace"}, "api_origin": API}
    token = client.post("/api/collaboration/auth/token", headers=HEADERS).json()
    assert token == {"access_token": "token-account-1", "expires_at": 4_000_000_000, "account_id": "account-1"}
    assert "set-cookie" not in session.headers and seen["calls"] == 2
    assert client.post("/api/collaboration/auth/login", headers=HEADERS).status_code == 404
    assert client.post("/api/collaboration/auth/logout", headers=HEADERS).json()["logged_out"] is True


def test_nothing_reaches_the_server_until_the_student_confirms_the_connection(world):
    client, server, seen = app_for(world, agreed=False)
    status = client.post("/api/collaboration/auth/status", headers=HEADERS)
    assert status.json() == {"configured": True, "server": "collab.example", "consented": False}
    for path in ("session", "token"):
        assert client.post(f"/api/collaboration/auth/{path}", headers=HEADERS).status_code == 403
    assert not server.calls
    assert client.post("/api/collaboration/auth/consent", headers=HEADERS).json() == {"consented": True}
    assert client.post("/api/collaboration/auth/status", headers=HEADERS).json()["consented"] is True
    assert client.post("/api/collaboration/auth/session", headers=HEADERS).status_code == 200
    assert client.delete("/api/collaboration/auth/consent", headers=HEADERS).json() == {"consented": False}
    assert client.post("/api/collaboration/auth/token", headers=HEADERS).status_code == 403


def test_consent_is_per_student_and_the_status_route_is_origin_protected(world):
    client, server, seen = app_for(world, agreed=False)
    other = app_for(world, local="student-2")[0]
    assert other.post("/api/collaboration/auth/status", headers=HEADERS).json()["consented"] is True
    assert client.post("/api/collaboration/auth/status", headers=HEADERS).json()["consented"] is False
    assert client.post("/api/collaboration/auth/status", headers={**HEADERS, "Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/collaboration/auth/consent", headers={"Origin": HEADERS["Origin"]}).status_code == 403


def test_router_still_protects_the_key_from_other_sites_and_machines(world):
    client, server, seen = app_for(world)
    assert client.post("/api/collaboration/auth/token", headers={**HEADERS, "Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/collaboration/auth/token", headers={"Origin": HEADERS["Origin"]}).status_code == 403
    assert client.post("/api/collaboration/auth/token").status_code == 403
    remote = TestClient(client.app, client=("203.0.113.5", 50000))
    assert remote.post("/api/collaboration/auth/token", headers=HEADERS).status_code == 403
    assert not server.calls and seen["calls"] == 0


def test_router_reports_an_unreachable_service_clearly(world):
    server, vault, config, client = world
    server.status_override["/v1/auth/pow"] = 503
    app, _, _ = app_for(world)
    answer = app.post("/api/collaboration/auth/session", headers=HEADERS)
    assert answer.status_code == 503 and "not ready" in answer.json()["detail"]


def test_the_router_requires_a_way_to_name_the_local_student(world):
    with pytest.raises(ValueError):
        create_router(world[2])
