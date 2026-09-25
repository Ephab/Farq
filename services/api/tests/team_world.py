"""Shared fixtures for the Group Projects tests.

Import `client` into a test module to use the fixture:
    from team_world import client, hdr  # noqa: F401
"""
import os
import tempfile
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"farq-teams-{uuid.uuid4()}.db"
# Same as the other test modules: never let an inherited DATABASE_URL point tests at real data.
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.database import engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()


def hdr(user_id: str) -> dict:
    return {"X-Farq-User": user_id}
