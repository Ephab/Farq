"""Isolation and configuration boundaries of the collaboration service."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from collaboration.config import Settings
from collaboration.database import Base
from collaboration.main import create_app
from collaboration.models import Account

from support import SEED, Device, bearer, get_token, make_settings, register

URL = "postgresql+psycopg://test:test@127.0.0.1/collaboration_test"


@pytest.fixture
def settings():
    return make_settings(URL, allowed_origins=["https://app.example"])


@pytest.fixture
def harness(settings):
    # SQLite only exercises isolated identity behavior; production Settings disallow it.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    app = create_app(settings)
    app.state.sessions = sessionmaker(engine, expire_on_commit=False)
    with TestClient(app) as client:
        yield client, app
    engine.dispose()


def account(client, name):
    device = Device()
    assert register(client, device, name).status_code == 200
    return device, get_token(client, device).json()["access_token"]


def test_two_devices_are_two_accounts_with_stable_identity(harness):
    client, app = harness
    _, first = account(client, "Student A")
    _, second = account(client, "Student B")
    one, two = client.get("/v1/me", headers=bearer(first)), client.get("/v1/me", headers=bearer(second))
    assert one.status_code == two.status_code == 200 and one.json()["id"] != two.json()["id"]
    assert client.get("/v1/me", headers=bearer(first)).json() == one.json()
    assert set(one.json()) == {"id", "display_name"} and one.headers["cache-control"] == "no-store"
    with app.state.sessions() as db:
        assert len(db.scalars(select(Account)).all()) == 2


def test_no_demo_identity_cookie_or_query_auth(harness):
    client, _ = harness
    _, token = account(client, "Student A")
    for headers in ({}, {"X-Waypoint-User": "student-a"}, {"Cookie": f"token={token}"}):
        assert client.get("/v1/me?as=student-a", headers=headers).status_code == 401
    assert client.get("/api/demo/users").status_code == 404


def test_disabled_account_is_rejected_even_with_a_still_valid_token(harness):
    client, app = harness
    device, token = account(client, "Student A")
    account_id = client.get("/v1/me", headers=bearer(token)).json()["id"]
    with app.state.sessions() as db:
        db.get(Account, account_id).disabled = True
        db.commit()
    assert client.get("/v1/me", headers=bearer(token)).status_code == 403
    assert get_token(client, device).status_code == 403


def test_health_schema_and_cors(harness):
    client, app = harness
    assert client.get("/health/live").status_code == 200
    assert client.get("/health/ready").status_code == 503
    with app.state.sessions() as db:
        db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
        db.execute(text("INSERT INTO alembic_version VALUES ('0010_device_auth')"))
        db.commit()
    assert client.get("/health/ready").status_code == 200
    for origin, status in [("https://app.example", 200), ("https://attacker.example", 400)]:
        response = client.options("/v1/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                                                     "Access-Control-Request-Headers": "Authorization, X-Waypoint-Client-Version, ngrok-skip-browser-warning"})
        assert response.status_code == status


@pytest.mark.parametrize("change", [
    {"database_url": "sqlite:///../../data/waypoint.db"},
    {"allowed_origins": ["*"]}, {"allowed_origins": ["https://app.example/path"]},
    {"allowed_origins": ["https://user:secret@app.example"]}, {"allowed_origins": ["http://localhost:5173"]},
    {"device_signing_key": "short"}, {"device_signing_key": "!" * 43},
])
def test_configuration_fails_closed(settings, change):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **(settings.model_dump() | {"device_signing_key": SEED} | change))


def test_a_signing_key_is_always_required():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url=URL)


def test_personal_environment_not_reused(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///personal.db")
    monkeypatch.delenv("COLLAB_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, device_signing_key=SEED)


def test_loopback_http_origins_are_only_allowed_in_development():
    assert make_settings(URL, environment="development", allowed_origins=["http://localhost:5173", "http://127.0.0.1:5173"])
    with pytest.raises(ValidationError):
        make_settings(URL, environment="production", allowed_origins=["http://localhost:5173"])
