from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..identity import User  # noqa: F401  (registers the users table for the FKs below)
from ..models import now, uid


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_course_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(200))
    term: Mapped[str] = mapped_column(String(40), default="")
    # manual | blackboard
    source: Mapped[str] = mapped_column(String(16), default="manual")
    external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class CourseEnrollment(Base):
    __tablename__ = "course_enrollments"
    __table_args__ = (UniqueConstraint("course_id", "user_id", name="uq_course_enrollment"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    # student | instructor
    role: Mapped[str] = mapped_column(String(16), default="student")


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_assignment_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    title: Mapped[str] = mapped_column(String(240))
    # ProjectBrief shape (services/api/app/schemas.py)
    brief_json: Mapped[str] = mapped_column(Text, default="{}")
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deliverables_json: Mapped[str] = mapped_column(Text, default="[]")
    rubric_json: Mapped[str] = mapped_column(Text, default="[]")
    team_size_min: Mapped[int] = mapped_column(Integer, default=2)
    team_size_max: Mapped[int] = mapped_column(Integer, default=4)
    source: Mapped[str] = mapped_column(String(16), default="manual")
    external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    cover_seed: Mapped[str] = mapped_column(String(16))
    lead_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    charter_json: Mapped[str] = mapped_column(Text, default="{}")
    # Lead-chosen cap, within the assignment's limits; None means the assignment maximum.
    size_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The team's own project (from an accepted import), layered over the shared assignment brief.
    brief_json: Mapped[str] = mapped_column(Text, default="{}")
    deliverables_json: Mapped[str] = mapped_column(Text, default="[]")
    rubric_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamMember(Base):
    __tablename__ = "team_members"
    # One team per student per assignment, enforced by the database so racing
    # "create team" / "accept invite" requests cannot both succeed.
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", name="uq_team_member"),
        UniqueConstraint("assignment_id", "user_id", name="uq_team_member_assignment"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role_label: Mapped[str] = mapped_column(String(40), default="")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen_seq: Mapped[int] = mapped_column(Integer, default=0)


class TeamInvite(Base):
    __tablename__ = "team_invites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    invited_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    invited_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    # pending | accepted | declined
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Milestone(Base):
    __tablename__ = "milestones"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deliverable_key: Mapped[str | None] = mapped_column(String(24), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    # todo | doing | review | done
    status: Mapped[str] = mapped_column(String(16), default="todo", index=True)
    assignee_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    estimate_points: Mapped[int] = mapped_column(Integer, default=1)
    due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    depends_on_json: Mapped[str] = mapped_column(Text, default="[]")
    milestone_id: Mapped[str | None] = mapped_column(ForeignKey("milestones.id"), nullable=True, index=True)
    rubric_refs_json: Mapped[str] = mapped_column(Text, default="[]")
    rationale: Mapped[str] = mapped_column(Text, default="")
    # user | hermes
    created_by: Mapped[str] = mapped_column(String(16), default="user")
    position: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    source_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    pinned_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamMessage(Base):
    __tablename__ = "team_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    # None means Hermes (or the system for kind="system").
    author_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # text | notice | proposal | poll | system
    kind: Mapped[str] = mapped_column(String(16), default="text")
    content: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_to_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Set for private notices and catch-ups; None means the whole team.
    visible_to_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(ForeignKey("team_messages.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    emoji: Mapped[str] = mapped_column(String(16))


class PollVote(Base):
    """One row per voter, so concurrent votes never overwrite each other."""

    __tablename__ = "poll_votes"
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_poll_vote"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    message_id: Mapped[str] = mapped_column(ForeignKey("team_messages.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    option: Mapped[int] = mapped_column(Integer)


class TeamDocument(Base):
    __tablename__ = "team_documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    # srs | sds | spmp | custom
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class DocSection(Base):
    __tablename__ = "doc_sections"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    document_id: Mapped[str] = mapped_column(ForeignKey("team_documents.id"), index=True)
    key: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(160))
    position: Mapped[int] = mapped_column(Integer, default=0)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    content_md: Mapped[str] = mapped_column(Text, default="")
    # empty | draft | accepted
    status: Mapped[str] = mapped_column(String(16), default="empty")
    lock_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    lock_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    meta_json: Mapped[str] = mapped_column(Text, default="{}")


class TeamEvent(Base):
    """Append-only team log. Written in the same transaction as the change it
    describes; the SSE stream, catch-up, replay and contribution read it."""

    __tablename__ = "team_events"
    __table_args__ = {"sqlite_autoincrement": True}
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    type: Mapped[str] = mapped_column(String(40))
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    visible_to_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamProposal(Base):
    """A change Hermes suggested. Nothing changes until a member applies it."""

    __tablename__ = "team_proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    # personal (the affected member decides) | team (majority vote, then the lead)
    scope: Mapped[str] = mapped_column(String(16))
    affected_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # task_split | task_edit | task_delete | task_reorganize | task_merge | doc_section | charter | milestones
    # | section_owners | brief | deliverables | rubric | batch
    kind: Mapped[str] = mapped_column(String(24))
    summary: Mapped[str] = mapped_column(String(240))
    payload_json: Mapped[str] = mapped_column(Text)
    base_seq: Mapped[int] = mapped_column(Integer, default=0)
    # pending | applied | rejected | stale | awaiting_lead
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    votes_json: Mapped[str] = mapped_column(Text, default="{}")
    invoked_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # None (the normal path) | lead_override
    decided_via: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Advisory notes shown on the card (e.g. an uneven workload); never block the vote.
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")


class TeamImport(Base):
    """A project description a member imported. Holds only the redacted, extracted rows, never the file."""

    __tablename__ = "team_imports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    filename: Mapped[str] = mapped_column(String(240), default="")
    # reading (Hermes is extracting) | review | failed | proposed | discarded
    status: Mapped[str] = mapped_column(String(16), default="reading", index=True)
    items_json: Mapped[str] = mapped_column(Text, default="[]")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposal_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamAgentRun(Base):
    """One Hermes invocation in a team chat. Runs execute one at a time per team."""

    __tablename__ = "team_agent_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    invoked_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    trigger_message_id: Mapped[str] = mapped_column(String(36))
    # mention | split | catchup | describe | draft | standup | risks
    command: Mapped[str] = mapped_column(String(24))
    argument: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str | None] = mapped_column(String(24), nullable=True)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # queued | running | completed | failed
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(80), default="Queued")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    digest_until_seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
