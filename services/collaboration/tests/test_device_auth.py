"""Silent device accounts: registration, signed-challenge tokens, abuse controls and mode isolation (PostgreSQL)."""
import base64
import os
import time
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient
import jwt
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from collaboration import device_auth
from collaboration.config import Settings
from support import SEED, SERVER_KEY, Device, b64, bearer, get_token, make_settings, register
from collaboration.main import create_app



@pytest.fixture
def world(request):
    url = os.getenv("COLLAB_TEST_DATABASE_URL")
    if not url:
        pytest.skip("COLLAB_TEST_DATABASE_URL required")
    settings = make_settings(url, teams_enabled=True, **getattr(request, "param", {}))
    schema = "collab_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as db:
        db.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    os.environ["COLLAB_DATABASE_URL"] = url
    os.environ["COLLAB_AUTH_MODE"] = "device"
    os.environ["COLLAB_DEVICE_SIGNING_KEY"] = SEED
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        app = create_app(settings)
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        with TestClient(app) as client:
            yield client, app, settings
    finally:
        for name in ("COLLAB_AUTH_MODE", "COLLAB_DEVICE_SIGNING_KEY"):
            os.environ.pop(name, None)
        engine.dispose()
        with admin.begin() as db:
            db.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def test_a_new_device_gets_an_account_id_and_can_use_the_service_without_any_login(world):
    client, app, settings = world
    device = Device()
    registered = register(client, device, "Rashed Alkhathlan")
    assert registered.status_code == 200 and registered.json()["created"] is True
    account_id = registered.json()["account_id"]
    issued = get_token(client, device)
    assert issued.status_code == 200
    body = issued.json()
    assert body["account"] == {"id": account_id, "display_name": "Rashed Alkhathlan"}
    me = client.get("/v1/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200 and me.json() == {"id": account_id, "display_name": "Rashed Alkhathlan"}
    assert client.get("/v1/capabilities", headers=bearer(body["access_token"])).json()["api_version"] == 1
    created = client.post("/v1/teams", json={"name": "My first project"}, headers=bearer(body["access_token"]))
    assert created.status_code == 201
    assert 0 < body["expires_at"] - int(time.time()) <= 300


def test_registering_the_same_key_twice_returns_the_same_account(world):
    client, *_ = world
    device = Device()
    first, second = register(client, device, "A"), register(client, device, "Different")
    assert first.json()["account_id"] == second.json()["account_id"] and second.json()["created"] is False
    assert get_token(client, device).json()["account"]["display_name"] == "A"


def test_two_devices_are_two_distinct_accounts(world):
    client, *_ = world
    one, two = Device(), Device()
    assert register(client, one, "One").json()["account_id"] != register(client, two, "Two").json()["account_id"]


def test_registration_needs_a_valid_fresh_proof_of_work(world):
    client, app, settings = world
    device = Device()
    challenge = client.get("/v1/auth/pow").json()["challenge"]
    payload = {"public_key": device.public, "display_name": "X", "challenge": challenge}
    wrong = next(str(n) for n in range(100000) if not device_auth.pow_ok(challenge, device.public, str(n), 8))
    assert client.post("/v1/auth/register", json={**payload, "nonce": wrong}).status_code == 422
    good = device.solve(challenge, 8)
    other = Device()
    assert client.post("/v1/auth/register", json={**payload, "public_key": other.public, "nonce": good}).status_code == 422  # work is bound to the key
    random_part, expires, tag = challenge.split(".")
    for forged in (f"{random_part}.{expires}.{'A' * len(tag)}", f"{random_part}.{int(expires) + 99999}.{tag}", "garbage", ""):
        assert client.post("/v1/auth/register", json={**payload, "challenge": forged, "nonce": good}).status_code == 422
    expired = f"{random_part}.{int(time.time()) - 5}"
    expired = f"{expired}.{device_auth.mac(settings, 'pow', expired)}"
    assert client.post("/v1/auth/register", json={**payload, "challenge": expired, "nonce": device.solve(expired, 8)}).status_code == 422
    assert client.post("/v1/auth/register", json={**payload, "nonce": good}).status_code == 200


def test_bad_keys_and_names_are_rejected(world):
    client, *_ = world
    device = Device()
    challenge = client.get("/v1/auth/pow").json()["challenge"]
    base = {"display_name": "X", "challenge": challenge, "nonce": "1"}
    for bad in ("short", "A" * 43, "!" * 43, b64(b"x" * 31) + "AA"):
        assert client.post("/v1/auth/register", json={**base, "public_key": bad}).status_code in {422}
    assert register(client, Device(), "   ").status_code == 422
    assert register(client, Device(), "\x00\x01").status_code == 422
    assert register(client, Device(), "x" * 121).status_code == 422


@pytest.mark.parametrize("world", [{"device_registrations_per_day": 2}], indirect=True)
def test_there_is_a_daily_cap_on_new_accounts(world):
    client, *_ = world
    known = Device()
    assert [register(client, known).status_code, register(client, Device()).status_code, register(client, Device()).status_code] == [200, 200, 429]
    # An existing key is not a new account and is never refused by the cap.
    again = register(client, known)
    assert again.status_code == 200 and again.json()["created"] is False


def test_tokens_need_the_private_key_and_a_fresh_single_use_challenge(world):
    client, app, settings = world
    device, thief = Device(), Device()
    register(client, device)
    nonce = client.post("/v1/auth/challenge", json={"public_key": device.public}).json()["nonce"]
    forged = {"public_key": device.public, "nonce": nonce, "signature": thief.sign(nonce)}
    assert client.post("/v1/auth/token", json=forged).status_code == 401
    ok = {"public_key": device.public, "nonce": nonce, "signature": device.sign(nonce)}
    assert client.post("/v1/auth/token", json=ok).status_code == 200
    assert client.post("/v1/auth/token", json=ok).status_code == 401  # replay
    other_nonce = client.post("/v1/auth/challenge", json={"public_key": thief.public}).json()["nonce"]
    stolen = {"public_key": device.public, "nonce": other_nonce, "signature": device.sign(other_nonce)}
    assert client.post("/v1/auth/token", json=stolen).status_code == 401  # a challenge is bound to the key it was issued for
    assert client.post("/v1/auth/token", json={**ok, "nonce": "a.b.c"}).status_code == 401
    unregistered = Device()
    assert get_token(client, unregistered).status_code == 401


def test_challenges_expire(world, monkeypatch):
    client, *_ = world
    device = Device()
    register(client, device)
    nonce = client.post("/v1/auth/challenge", json={"public_key": device.public}).json()["nonce"]
    real = time.time
    monkeypatch.setattr(device_auth.time, "time", lambda: real() + 120)
    assert client.post("/v1/auth/token", json={"public_key": device.public, "nonce": nonce, "signature": device.sign(nonce)}).status_code == 401


def test_only_tokens_this_service_signed_are_accepted(world):
    client, app, settings = world
    device = Device()
    register(client, device)
    good = get_token(client, device).json()["access_token"]
    assert client.get("/v1/me", headers=bearer(good)).status_code == 200
    claims = jwt.decode(good, options={"verify_signature": False})
    attacker = Ed25519PrivateKey.generate()
    for forged in (jwt.encode(claims, attacker, algorithm="EdDSA"),
                   jwt.encode({**claims, "exp": claims["iat"] - 1, "iat": claims["iat"] - 100}, SERVER_KEY, algorithm="EdDSA"),
                   jwt.encode({**claims, "exp": claims["iat"] + 3600}, SERVER_KEY, algorithm="EdDSA"),
                   jwt.encode({**claims, "scope": "other"}, SERVER_KEY, algorithm="EdDSA"),
                   jwt.encode({**claims, "aud": "someone-else"}, SERVER_KEY, algorithm="EdDSA"),
                   jwt.encode({**claims, "iss": "https://evil.example"}, SERVER_KEY, algorithm="EdDSA"),
                   jwt.encode(claims, "secret" * 8, algorithm="HS256"), good + "x", "a.b.c", ""):
        assert client.get("/v1/me", headers=bearer(forged)).status_code == 401, forged[:30]
    assert client.get("/v1/me").status_code == 401


def test_a_disabled_account_cannot_get_or_use_tokens(world):
    client, app, settings = world
    device = Device()
    registered = register(client, device).json()
    token = get_token(client, device).json()["access_token"]
    with app.state.sessions() as db:
        db.execute(text("UPDATE accounts SET disabled = true WHERE id = :id"), {"id": registered["account_id"]})
        db.commit()
    assert client.get("/v1/me", headers=bearer(token)).status_code == 403
    assert get_token(client, device).status_code == 403


def test_two_devices_cannot_see_each_others_private_projects(world):
    client, *_ = world
    one, two = Device(), Device()
    register(client, one, "One"), register(client, two, "Two")
    first, second = get_token(client, one).json()["access_token"], get_token(client, two).json()["access_token"]
    team = client.post("/v1/teams", json={"name": "Private"}, headers=bearer(first)).json()["id"]
    assert client.get(f"/v1/teams/{team}/state", headers=bearer(second)).status_code == 403


def test_settings_require_a_real_signing_key():
    base = dict(_env_file=None, environment="production", database_url="postgresql+psycopg://u:p@db/x", allowed_origins=[])
    with pytest.raises(ValueError, match="device_signing_key|COLLAB_DEVICE_SIGNING_KEY"):
        Settings(**base)
    with pytest.raises(ValueError, match="COLLAB_DEVICE_SIGNING_KEY"):
        Settings(**base, device_signing_key="short")
    assert Settings(**base, device_signing_key=SEED).device_pow_bits == 18
