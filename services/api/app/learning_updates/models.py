from __future__ import annotations
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Index, text
from sqlalchemy.orm import Mapped, mapped_column
from ..database import Base
from ..models import now, uid


class Subscription(Base):
    __tablename__ = "learning_subscriptions"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    topic_id: Mapped[str] = mapped_column(String(60), primary_key=True)


class Post(Base):
    __tablename__ = "learning_posts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    platform: Mapped[str] = mapped_column(String(10), index=True)
    platform_id: Mapped[str] = mapped_column(String(100))
    url: Mapped[str] = mapped_column(String(500))
    title: Mapped[str] = mapped_column(String(240))
    excerpt: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(100))
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    engagement: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (Index("ux_learning_post", "platform", "platform_id", unique=True),)


class PostTopic(Base):
    __tablename__ = "learning_post_topics"
    post_id: Mapped[str] = mapped_column(ForeignKey("learning_posts.id"), primary_key=True)
    topic_id: Mapped[str] = mapped_column(String(60), primary_key=True)


class Dismissal(Base):
    __tablename__ = "learning_dismissals"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    post_id: Mapped[str] = mapped_column(ForeignKey("learning_posts.id"), primary_key=True)


class RefreshRun(Base):
    __tablename__ = "learning_refresh_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    topic_id: Mapped[str] = mapped_column(String(60), index=True)
    platform: Mapped[str] = mapped_column(String(10))
    actor: Mapped[str] = mapped_column(String(120))
    # queued -> starting -> running -> finished. Unknown launch outcome stays unresolved.
    state: Mapped[str] = mapped_column(String(24), default="queued")
    outcome: Mapped[str | None] = mapped_column(String(24), nullable=True)
    apify_run_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    since_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Integer millionths of a dollar: no floating-point budget arithmetic.
    reserved: Mapped[int] = mapped_column(Integer, default=100000)
    charged: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(String(240), nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (Index("ux_learning_active_pair", "topic_id", "platform", unique=True,
        sqlite_where=text("state != 'finished'")),)
