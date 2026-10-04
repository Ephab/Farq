from contextlib import contextmanager
from fastapi import Request
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import Settings


class Base(DeclarativeBase):
    pass


@event.listens_for(Session, "after_begin")
def serialize_team_transactions(session, transaction, connection):
    # Pilot correctness first: one advisory transaction lock serializes team state
    # mutations and event sequence allocation, including new transactions after commit.
    # This also prevents a late commit with a lower event cursor from being skipped.
    if session.info.get("central_team") and connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(87241001)"))


@contextmanager
def team_session(sessions):
    with sessions() as db:
        db.info["central_team"] = True
        yield db


def get_db(request: Request):
    with team_session(request.app.state.sessions) as db:
        yield db


def database(settings: Settings):
    engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args={"connect_timeout": 5})
    return engine, sessionmaker(bind=engine, expire_on_commit=False)
