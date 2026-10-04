from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..models import uid


class MailConnection(Base):
    __tablename__ = "outlook_connections"
    __table_args__ = (UniqueConstraint("tenant", "account_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    tenant: Mapped[str] = mapped_column(String)
    account_id: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String)
    token_cache: Mapped[str] = mapped_column(Text, default="")
    connected: Mapped[bool] = mapped_column(Boolean, default=True)
    # Sync never starts on its own: every sign-in leaves the connection paused
    # until the student enables sync in Settings (PATCH /preferences auto_sync=true).
    auto_sync: Mapped[bool] = mapped_column(Boolean, default=False)
    # Automatic Jev -> Span -> Laya policy. Legacy choices are migrated at startup.
    classifier: Mapped[str] = mapped_column(String, default="auto")
    # Classify only the N most recent emails; None = no cutoff. Older mail is stored unclassified.
    classify_limit: Mapped[int | None] = mapped_column(Integer, nullable=True, default=50)
    generation: Mapped[int] = mapped_column(Integer, default=1)
    next_sync: Mapped[float] = mapped_column(Float, default=0)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    lease_id: Mapped[str] = mapped_column(String, default="")
    last_sync: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String, default="queued")
    error: Mapped[str] = mapped_column(String, default="")
    folders_json: Mapped[str] = mapped_column(Text, default="[]")
    folder_scan_url: Mapped[str] = mapped_column(Text, default="")
    processed: Mapped[int] = mapped_column(Integer, default=0)


class MailCoachGrant(Base):
    __tablename__ = "outlook_coach_grants"
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    session_hash: Mapped[str] = mapped_column(String)
    run_id: Mapped[str] = mapped_column(String)
    connection_id: Mapped[str] = mapped_column(String)
    generation: Mapped[int] = mapped_column(Integer)
    expires: Mapped[float] = mapped_column(Float)


class MailSession(Base):
    __tablename__ = "outlook_sessions"
    coach_access: Mapped[bool] = mapped_column(Boolean, default=False)
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires: Mapped[float] = mapped_column(Float)


class MailboxConsent(Base):
    __tablename__ = "outlook_desktop_consents"
    token_hash: Mapped[str] = mapped_column(String, primary_key=True)
    expires: Mapped[float] = mapped_column(Float)


class MailFolder(Base):
    __tablename__ = "outlook_folders"
    __table_args__ = (UniqueConstraint("connection_id", "remote_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    connection_id: Mapped[str] = mapped_column(ForeignKey("outlook_connections.id"), index=True)
    remote_id: Mapped[str] = mapped_column(String)
    cursor: Mapped[str] = mapped_column(Text, default="")
    next_page: Mapped[str] = mapped_column(Text, default="")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    rebuild_id: Mapped[str] = mapped_column(String, default=uid)


class MailItem(Base):
    __tablename__ = "outlook_items"
    __table_args__ = (UniqueConstraint("connection_id", "remote_id"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    connection_id: Mapped[str] = mapped_column(ForeignKey("outlook_connections.id"), index=True)
    remote_id: Mapped[str] = mapped_column(String)
    folder_id: Mapped[str] = mapped_column(String)
    scan_id: Mapped[str] = mapped_column(String, default="")
    subject: Mapped[str] = mapped_column(String)
    sender: Mapped[str] = mapped_column(String)
    excerpt: Mapped[str] = mapped_column(Text)
    received: Mapped[str] = mapped_column(String)
    web_url: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String)
    classification: Mapped[str] = mapped_column(Text, default="{}")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    # New or changed text awaiting classification (done newest-first once folders are scanned).
    pending: Mapped[bool] = mapped_column(Boolean, default=False)
    due_date: Mapped[str | None] = mapped_column(String, nullable=True)
    expires: Mapped[float] = mapped_column(Float)
