"""Backup and verified restore for the collaboration database (PostgreSQL custom-format dumps).

    python scripts/backup.py backup  --out backups/collab.dump
    python scripts/backup.py verify  --file backups/collab.dump      # restore into a throwaway database, compare, drop it
    python scripts/backup.py restore --file backups/collab.dump --into postgresql+psycopg://.../empty_db

Credentials go to the PostgreSQL tools through PG* environment variables, never the command line.
`restore` refuses a target that already contains tables. Dumps hold private chat and profiles: store them
encrypted, with the same access as the database, and delete them after the retention window.
Tool lookup: COLLAB_PG_BIN, then PATH.
"""
from __future__ import annotations

import argparse
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

SERVICE = Path(__file__).resolve().parents[1]


def tool(name: str) -> str:
    folder = os.getenv("COLLAB_PG_BIN")
    found = shutil.which(name, path=folder) if folder else shutil.which(name)
    if not found:
        raise SystemExit(f"{name} not found; set COLLAB_PG_BIN to the PostgreSQL bin directory")
    return found


def pg_env(url: URL) -> dict:
    env = {**os.environ, "PGHOST": url.host or "127.0.0.1", "PGPORT": str(url.port or 5432), "PGUSER": url.username or ""}
    if url.password:
        env["PGPASSWORD"] = url.password
    return env


def database_url() -> URL:
    value = os.getenv("COLLAB_DATABASE_URL")
    if not value:
        raise SystemExit("COLLAB_DATABASE_URL is not set (load it from this service's .env)")
    url = make_url(value)
    if url.drivername != "postgresql+psycopg":
        raise SystemExit("Only the collaboration PostgreSQL database can be backed up")
    return url


def table_counts(url: URL) -> dict[str, int]:
    engine = create_engine(url)
    try:
        with engine.connect() as db:
            names = [row[0] for row in db.execute(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"))]
            return {name: db.execute(text(f'SELECT count(*) FROM "{name}"')).scalar_one() for name in names}
    finally:
        engine.dispose()


def backup(url: URL, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        raise SystemExit(f"{out} exists; refusing to overwrite a backup")
    temp = out.with_suffix(out.suffix + ".partial")
    subprocess.run([tool("pg_dump"), "--format=custom", "--no-owner", "--no-privileges", "--schema=public", "--file", str(temp), url.database],
                   check=True, env=pg_env(url), capture_output=True)
    temp.replace(out)
    if os.name == "posix":
        out.chmod(0o600)
    return out


def restore(dump: Path, target: URL) -> None:
    if not dump.is_file():
        raise SystemExit(f"{dump} not found")
    engine = create_engine(target)
    try:
        with engine.connect() as db:
            if db.execute(text("SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")).scalar_one():
                raise SystemExit("The target database is not empty; restore into a new, empty database")
    finally:
        engine.dispose()
    # A fresh database already has the public schema; skip its CREATE/COMMENT entries and keep everything else.
    listing = subprocess.run([tool("pg_restore"), "--list", str(dump)], check=True, env=pg_env(target), capture_output=True, text=True).stdout
    keep = "\n".join(line for line in listing.splitlines() if " SCHEMA - public " not in line) + "\n"
    with tempfile.TemporaryDirectory() as folder:
        selection = Path(folder) / "restore.list"
        selection.write_text(keep, encoding="utf-8")
        subprocess.run([tool("pg_restore"), "--no-owner", "--no-privileges", "--exit-on-error", "--use-list", str(selection),
                        "--dbname", target.database, str(dump)], check=True, env=pg_env(target), capture_output=True)


def verify(dump: Path, source: URL) -> dict[str, int]:
    """Restore into a throwaway database and require the same tables, rows and schema revision as the source."""
    scratch = f"collab_restore_check_{secrets.token_hex(4)}"
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    target = source.set(database=scratch)
    try:
        with admin.connect() as db:
            db.execute(text(f'CREATE DATABASE "{scratch}"'))
        restore(dump, target)
        restored, original = table_counts(target), table_counts(source)
        revision = create_engine(target)
        try:
            with revision.connect() as db:
                restored_revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        finally:
            revision.dispose()
        if restored != original:
            drift = {name: (original.get(name), restored.get(name)) for name in original.keys() | restored.keys() if original.get(name) != restored.get(name)}
            raise SystemExit(f"Restore does not match the source (changes since the dump are expected on a live database): {drift}")
        print(f"Restore verified: {len(restored)} tables, revision {restored_revision}")
        return restored
    finally:
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE IF EXISTS "{scratch}" WITH (FORCE)'))
        admin.dispose()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("backup").add_argument("--out", type=Path, required=True)
    sub.add_parser("verify").add_argument("--file", type=Path, required=True)
    restoring = sub.add_parser("restore")
    restoring.add_argument("--file", type=Path, required=True)
    restoring.add_argument("--into", required=True, help="Database URL of an existing EMPTY database")
    args = parser.parse_args(argv)
    if args.action == "backup":
        print(f"Wrote {backup(database_url(), args.out)}")
    elif args.action == "verify":
        verify(args.file, database_url())
    else:
        target = make_url(args.into)
        if target.drivername != "postgresql+psycopg":
            raise SystemExit("--into must be a postgresql+psycopg URL")
        restore(args.file, target)
        print("Restored")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(f"{error.cmd[0]} failed: {error.stderr.decode(errors='replace')[-400:]}")
