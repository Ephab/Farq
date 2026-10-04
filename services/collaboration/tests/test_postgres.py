"""Opt-in real database checks; use an isolated schema, never public tables."""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from support import ISSUER, make_settings
from collaboration.main import create_app
from collaboration.identity import Identity
from collaboration.database import Base


@pytest.mark.skipif(not os.getenv("COLLAB_TEST_DATABASE_URL"), reason="Set COLLAB_TEST_DATABASE_URL for PostgreSQL integration")
def test_migrations_and_concurrent_identity(monkeypatch):
    url = os.environ["COLLAB_TEST_DATABASE_URL"]
    # Settings rejects non-PostgreSQL before any connection is opened.
    settings = make_settings(url)
    monkeypatch.setenv("COLLAB_DATABASE_URL", url)
    schema = "collab_test_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "0002_teams")
            connection.execute(text("INSERT INTO courses (id, code, title, term, source) VALUES ('existing-course', 'CS', 'Existing class', '', 'manual')"))
            command.upgrade(config, "head")
            assert connection.execute(text("SELECT created_at FROM courses WHERE id='existing-course'")).scalar_one() is not None
            assert set(inspect(connection).get_table_names(schema=schema)) == set(Base.metadata.tables) | {"alembic_version"}
            command.check(config)
        app = create_app(settings)
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        class VerifiedIdentity:
            def verify(self, token):
                return Identity(ISSUER, token, "Student")
        # Signature tests live in test_boundary; this test isolates DB uniqueness races.
        app.state.verifier = VerifiedIdentity()
        with TestClient(app) as client:
            def request(_):
                return client.get("/v1/me", headers={"Authorization": "Bearer simultaneous-account"})
            with ThreadPoolExecutor(max_workers=8) as pool:
                responses = list(pool.map(request, range(16)))
            assert all(response.status_code == 200 for response in responses)
            assert len({response.json()["id"] for response in responses}) == 1
            assert client.get("/health/ready").status_code == 200
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.downgrade(config, "base")
            assert "accounts" not in inspect(connection).get_table_names(schema=schema)
    finally:
        engine.dispose()
        # Only the randomly generated schema created by this test is removed.
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
