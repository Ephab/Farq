from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


default_db = Path(__file__).resolve().parents[2] / "data" / "waypoint.db"
default_db.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{default_db.as_posix()}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)


if DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(connection, _record) -> None:
        # Background runs, source syncs and event streams write concurrently: WAL lets readers
        # continue during a write, and the busy timeout waits for the lock instead of failing.
        cursor = connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


# Columns added after the first release. create_all() never alters existing
# tables, so older local SQLite databases get them here (no migration tool yet).
ADDED_COLUMNS = {
    "blackboard_courses": {
        "is_current": "BOOLEAN NOT NULL DEFAULT 0",
        "instructors_json": "TEXT NOT NULL DEFAULT '[]'",
        "grade_summary_json": "TEXT NOT NULL DEFAULT '{}'",
        "url": "VARCHAR(500) NOT NULL DEFAULT ''",
    },
    "blackboard_content_items": {"url": "VARCHAR(500) NOT NULL DEFAULT ''"},
    "outlook_sessions": {"coach_access": "BOOLEAN NOT NULL DEFAULT 0"},
    "outlook_connections": {"classifier": "VARCHAR(16) NOT NULL DEFAULT 'laya'", "classify_limit": "INTEGER"},
    "outlook_items": {"pending": "BOOLEAN NOT NULL DEFAULT 0"},
    "student_facts": {
        "source_kind": "VARCHAR(24) NOT NULL DEFAULT 'chat'",
        "evidence_id": "VARCHAR(36)",
    },
    "roadmap_proposals": {
        "kind": "VARCHAR(16) NOT NULL DEFAULT 'ops'",
        "snapshot_json": "TEXT",
    },
    "chat_messages": {
        "metadata_json": "TEXT",
    },
    "agent_runs": {
        "ui_json": "TEXT",
    },
    "teams": {
        "size_limit": "INTEGER",
        "brief_json": "TEXT NOT NULL DEFAULT '{}'",
        "deliverables_json": "TEXT NOT NULL DEFAULT '[]'",
        "rubric_json": "TEXT NOT NULL DEFAULT '[]'",
    },
    "team_imports": {
        "error": "TEXT",
    },
    "team_proposals": {
        "decided_via": "VARCHAR(16)",
        "warnings_json": "TEXT NOT NULL DEFAULT '[]'",
    },
    "coop_postings": {
        "canonical_key": "VARCHAR(64) NOT NULL DEFAULT ''",
        "published_at": "DATETIME",
        "last_seen_at": "DATETIME",
        "extracted_json": "TEXT",
        "extraction_status": "VARCHAR(16) NOT NULL DEFAULT 'pending'",
        "extracted_at": "DATETIME",
    },
}


def ensure_added_columns() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    with engine.begin() as connection:
        for table, columns in ADDED_COLUMNS.items():
            existing = {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table})")}
            for name, ddl in columns.items():
                if existing and name not in existing:
                    connection.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


# Invariants the ORM cannot express with create_all on an existing database. Each is created
# only if it does not exist; an old database that already violates one keeps working and logs.
INDEXES = {
    # At most one active roadmap per student, even if two accepts race.
    "ux_roadmap_versions_one_active": "CREATE UNIQUE INDEX IF NOT EXISTS ux_roadmap_versions_one_active ON roadmap_versions(student_id) WHERE active = 1",
    # One evidence row per student and fingerprint, even if two syncs race.
    "ux_evidence_items_student_fingerprint": "CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_items_student_fingerprint ON evidence_items(student_id, fingerprint)",
    "ix_student_facts_evidence_id": "CREATE INDEX IF NOT EXISTS ix_student_facts_evidence_id ON student_facts(evidence_id)",
}


def ensure_indexes() -> None:
    import logging
    for name, ddl in INDEXES.items():
        try:
            with engine.begin() as connection:
                connection.exec_driver_sql(ddl)
        except Exception as exc:  # existing duplicate rows: keep serving, report once
            logging.getLogger(__name__).warning("Could not create index %s: %s", name, exc)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

