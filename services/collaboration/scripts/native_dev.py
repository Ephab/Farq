"""One-time PostgreSQL setup for the shared server on Windows, without Docker or administrator services.

    python scripts/native_dev.py start    # downloads PostgreSQL (once), creates the database, starts it
    python scripts/native_dev.py stop

Needs `python scripts/init_dev.py` to have run first (it creates the local .env with the database password).
`server.bat start` also starts PostgreSQL by itself afterwards, so this is only needed for the first setup or to
manage the database on its own.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import urllib.request
import zipfile
from pathlib import Path

from dotenv import dotenv_values
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parents[1] / ".cache" / "collaboration-native"
PG_URL = "https://get.enterprisedb.com/postgresql/postgresql-17.11-3-windows-x64-binaries.zip"
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def install_postgres():
    destination = CACHE / "postgres"
    if (destination / ".complete").exists():
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    archive = CACHE / "postgres.zip"
    if not archive.exists():
        print("Downloading PostgreSQL from the publisher", flush=True)
        partial = archive.with_suffix(".part")
        urllib.request.urlretrieve(PG_URL, partial)
        partial.replace(archive)
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            if not member.filename.startswith(("pgsql/bin/", "pgsql/lib/", "pgsql/share/")):
                continue
            target = (destination / member.filename).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise RuntimeError("Archive path escapes installation directory")
            bundle.extract(member, destination)
    (destination / ".complete").write_text(json.dumps({"url": PG_URL}), encoding="utf-8")
    print("Installed PostgreSQL", flush=True)


def run(args, **kwargs):
    return subprocess.run([str(value) for value in args], creationflags=HIDDEN, check=True, **kwargs)


def start():
    if os.name != "nt":
        raise SystemExit("This setup targets Windows. On other systems, install PostgreSQL yourself and set COLLAB_DATABASE_URL.")
    env = {key: value for key, value in dotenv_values(ROOT / ".env").items() if value is not None}
    if not env.get("COLLAB_DEV_DB_PASSWORD"):
        raise SystemExit("Run scripts/init_dev.py first; this setup needs its local configuration.")
    install_postgres()
    pg = CACHE / "postgres/pgsql/bin"
    data = CACHE / "pgdata"
    if not (data / "PG_VERSION").exists():
        password_file = CACHE / ".init-password"
        password_file.write_text(env["COLLAB_DEV_DB_PASSWORD"], encoding="utf-8")
        try:
            run([pg / "initdb.exe", "-D", data, "-U", "waypoint", "-A", "scram-sha-256",
                 "--encoding=UTF8", "--locale=C", "--pwfile", password_file], stdout=subprocess.DEVNULL)
        finally:
            password_file.unlink(missing_ok=True)
        with (data / "postgresql.conf").open("a", encoding="utf-8") as output:
            output.write("\nlisten_addresses = '127.0.0.1'\nport = 55432\n")
    status = subprocess.run([str(pg / "pg_ctl.exe"), "-D", str(data), "status"], creationflags=HIDDEN, capture_output=True)
    if status.returncode != 0:
        run([pg / "pg_ctl.exe", "-D", data, "-l", CACHE / "postgres.log", "-w", "start"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # the server inherits these, so none may be a pipe
    with psycopg.connect(host="127.0.0.1", port=55432, user="waypoint", password=env["COLLAB_DEV_DB_PASSWORD"], dbname="postgres", autocommit=True) as connection:
        for name in ("waypoint_collaboration", "waypoint_collaboration_test"):
            if not connection.execute("SELECT 1 FROM pg_database WHERE datname=%s", (name,)).fetchone():
                connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    print("PostgreSQL is running on 127.0.0.1:55432. No Windows services were installed.")


def stop():
    pg, data = CACHE / "postgres/pgsql/bin/pg_ctl.exe", CACHE / "pgdata"
    if pg.exists() and (data / "postmaster.pid").exists():
        run([pg, "-D", data, "-m", "fast", "-w", "stop"])
    print("PostgreSQL stopped.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop"])
    args = parser.parse_args()
    start() if args.action == "start" else stop()
