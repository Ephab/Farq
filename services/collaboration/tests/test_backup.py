"""Backup, verified restore and refusal paths against the real PostgreSQL instance."""
import importlib.util
import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "backup.py"
spec = importlib.util.spec_from_file_location("collab_backup", SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)

URL = os.getenv("COLLAB_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="COLLAB_TEST_DATABASE_URL required")


@pytest.fixture
def pg_bin(monkeypatch):
    folder = os.getenv("COLLAB_PG_BIN") or str(Path(__file__).resolve().parents[3] / ".cache" / "collaboration-native" / "postgres" / "pgsql" / "bin")
    if not (Path(folder) / ("pg_dump.exe" if os.name == "nt" else "pg_dump")).exists():
        pytest.skip("PostgreSQL client tools not available")
    monkeypatch.setenv("COLLAB_PG_BIN", folder)


def test_backup_refuses_to_overwrite_and_leaves_no_partial_file(pg_bin, tmp_path):
    out = tmp_path / "one.dump"
    backup.backup(make_url(URL), out)
    assert out.stat().st_size > 0 and not list(tmp_path.glob("*.partial"))
    with pytest.raises(SystemExit, match="refusing to overwrite"):
        backup.backup(make_url(URL), out)


def test_dump_restores_into_an_empty_database_and_matches(pg_bin, tmp_path):
    source = make_url(URL)
    dump = backup.backup(source, tmp_path / "check.dump")
    counts = backup.verify(dump, source)
    assert "accounts" in counts and "team_agent_runs" in counts
    admin = create_engine(source.set(database="postgres"))
    with admin.connect() as db:  # the throwaway database is gone
        assert db.execute(text("SELECT count(*) FROM pg_database WHERE datname LIKE 'collab_restore_check_%'")).scalar_one() == 0
    admin.dispose()


def test_restore_refuses_a_non_empty_target(pg_bin, tmp_path):
    source = make_url(URL)
    dump = backup.backup(source, tmp_path / "again.dump")
    with pytest.raises(SystemExit, match="not empty"):
        backup.restore(dump, source)


def test_only_the_collaboration_postgres_url_is_accepted(monkeypatch):
    monkeypatch.setenv("COLLAB_DATABASE_URL", "sqlite:///personal.db")
    with pytest.raises(SystemExit, match="Only the collaboration PostgreSQL"):
        backup.database_url()
    monkeypatch.delenv("COLLAB_DATABASE_URL")
    with pytest.raises(SystemExit, match="not set"):
        backup.database_url()
