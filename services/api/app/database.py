from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


default_db = Path(__file__).resolve().parents[2] / "data" / "farq.db"
default_db.parent.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{default_db.as_posix()}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


# Columns added after the first release. create_all() never alters existing
# tables, so older local SQLite databases get them here (no migration tool yet).
ADDED_COLUMNS = {
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


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

