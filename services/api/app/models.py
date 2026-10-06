from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def uid() -> str:
    return str(uuid.uuid4())


def now() -> datetime:
    return datetime.now(timezone.utc)


class Student(Base):
    __tablename__ = "students"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    display_name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StudentFact(Base):
    __tablename__ = "student_facts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    key: Mapped[str] = mapped_column(String(120))
    value_json: Mapped[str] = mapped_column(Text)
    source_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # chat | branch | onboarding | confirmed_evidence
    source_kind: Mapped[str] = mapped_column(String(24), default="chat")
    evidence_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    confidence: Mapped[int] = mapped_column(Integer, default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StudentProfile(Base):
    __tablename__ = "student_profiles"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    institution: Mapped[str] = mapped_column(String(200), default="")
    program: Mapped[str] = mapped_column(String(200), default="")
    discipline: Mapped[str] = mapped_column(String(32), default="other")
    year_label: Mapped[str] = mapped_column(String(80), default="")
    grad_target: Mapped[str] = mapped_column(String(80), default="")
    # basics | sources | review | chat | generating | preview | done
    onboarding_status: Mapped[str] = mapped_column(String(16), default="basics")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class DataSource(Base):
    __tablename__ = "data_sources"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    label: Mapped[str] = mapped_column(String(200), default="")
    # Non-secret configuration only (username, path, URL, ORCID iD).
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvidenceItem(Base):
    __tablename__ = "evidence_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("data_sources.id"), index=True)
    kind: Mapped[str] = mapped_column(String(24), index=True)
    title: Mapped[str] = mapped_column(String(240))
    data_json: Mapped[str] = mapped_column(Text, default="{}")
    source_ref: Mapped[str] = mapped_column(String(500), default="")
    fingerprint: Mapped[str] = mapped_column(String(300), index=True)
    # suggested | confirmed | dismissed
    status: Mapped[str] = mapped_column(String(16), default="suggested", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class BlackboardCourse(Base):
    __tablename__ = "blackboard_courses"
    __table_args__ = (UniqueConstraint("student_id", "external_id", name="uq_blackboard_course_student_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(160), index=True)
    code: Mapped[str] = mapped_column(String(80), default="")
    title: Mapped[str] = mapped_column(String(240))
    term: Mapped[str] = mapped_column(String(120), default="")
    term_id: Mapped[str] = mapped_column(String(160), default="")
    lifecycle: Mapped[str] = mapped_column(String(16), default="unknown")
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    description: Mapped[str] = mapped_column(Text, default="")
    source_kind: Mapped[str] = mapped_column(String(32), default="blackboard_demo")
    is_current: Mapped[bool] = mapped_column(Boolean, default=False)
    instructors_json: Mapped[str] = mapped_column(Text, default="[]")
    grade_summary_json: Mapped[str] = mapped_column(Text, default="{}")
    url: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class BlackboardContentItem(Base):
    __tablename__ = "blackboard_content_items"
    __table_args__ = (UniqueConstraint("course_id", "external_id", name="uq_blackboard_item_course_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("blackboard_courses.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(200), index=True)
    parent_external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content_type: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body_text: Mapped[str] = mapped_column(Text, default="")
    filename: Mapped[str] = mapped_column(String(300), default="")
    mime_type: Mapped[str] = mapped_column(String(120), default="text/plain")
    source_ref: Mapped[str] = mapped_column(String(500), default="")
    url: Mapped[str] = mapped_column(String(500), default="")
    origin: Mapped[str] = mapped_column(String(32), default="local_material")
    checksum: Mapped[str] = mapped_column(String(64), index=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    modified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class BlackboardAttachment(Base):
    """Remote file catalog only. Original bytes are never kept on disk."""
    __tablename__ = "blackboard_attachments"
    __table_args__ = (UniqueConstraint("course_id", "content_id", "external_id", name="uq_bb_attachment"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("blackboard_courses.id"), index=True)
    content_id: Mapped[str] = mapped_column(String(200))
    external_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300), default="")
    filename: Mapped[str] = mapped_column(String(300))
    mime_type: Mapped[str] = mapped_column(String(120), default="")
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    download_url: Mapped[str] = mapped_column(Text)
    path: Mapped[str] = mapped_column(Text, default="")
    text_indexed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class BlackboardGrade(Base):
    __tablename__ = "blackboard_grades"
    __table_args__ = (UniqueConstraint("course_id", "external_id", name="uq_blackboard_grade_course_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("blackboard_courses.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    possible: Mapped[float | None] = mapped_column(Float, nullable=True)
    percentage: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="")
    feedback: Mapped[str] = mapped_column(Text, default="")
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BlackboardConnection(Base):
    """A student's live Blackboard login. Secrets are Fernet-sealed (docs/blackboard-threat-model.md)
    and never leave the server: no response, log line or Hermes tool sees them."""
    __tablename__ = "blackboard_connections"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    username: Mapped[str] = mapped_column(String(120), default="")
    password_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    # idle | queued | logging_in | extracting | reading_files | saving | done | failed
    status: Mapped[str] = mapped_column(String(16), default="idle")
    stage_detail: Mapped[str] = mapped_column(String(200), default="")
    failure_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # False: only syncs the student starts run; the periodic tick skips this connection.
    auto_sync: Mapped[bool] = mapped_column(Boolean, default=True)
    summary_json: Mapped[str] = mapped_column(Text, default="{}")
    collection_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ChatThread(Base):
    __tablename__ = "chat_threads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    title: Mapped[str] = mapped_column(String(160), default="Hermes Coach")
    hermes_session_id: Mapped[str] = mapped_column(String(120), unique=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    thread_id: Mapped[str] = mapped_column(ForeignKey("chat_threads.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)
    # Structured assistant controls or the user's response to those controls.
    # Kept separate from content so old text-only conversations remain valid.
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    agent_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RoadmapVersion(Base):
    __tablename__ = "roadmap_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    snapshot_json: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text, default="Initial roadmap")
    active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RoadmapProposal(Base):
    __tablename__ = "roadmap_proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    base_version_id: Mapped[str] = mapped_column(ForeignKey("roadmap_versions.id"))
    summary: Mapped[str] = mapped_column(String(240))
    reasoning: Mapped[str] = mapped_column(Text)
    operations_json: Mapped[str] = mapped_column(Text)
    # ops (diff against base) | initial (full generated graph in snapshot_json)
    kind: Mapped[str] = mapped_column(String(16), default="ops")
    snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    thread_id: Mapped[str] = mapped_column(ForeignKey("chat_threads.id"), index=True)
    user_message_id: Mapped[str] = mapped_column(ForeignKey("chat_messages.id"))
    hermes_run_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(80), default="Preparing context")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # UI Hermes staged with its chat tools during the run (app.chat_ui); attached to the reply at the end.
    ui_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DecisionRecord(Base):
    """Auditable Jev observation. Source text is deliberately never persisted."""
    __tablename__ = "decision_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(64), index=True)
    question_set_version: Mapped[str] = mapped_column(String(32), default="v1")
    entity_type: Mapped[str] = mapped_column(String(48), index=True)
    entity_id: Mapped[str] = mapped_column(String(200), index=True)
    model: Mapped[str] = mapped_column(String(80), default="jev-latest")
    mode: Mapped[str] = mapped_column(String(16), default="shadow", index=True)
    status: Mapped[str] = mapped_column(String(16), default="shadow", index=True)
    request_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    answers_json: Mapped[str] = mapped_column(Text, default="{}")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("student_id", "roadmap_node_id", name="uq_project_roadmap_node"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    roadmap_node_id: Mapped[str] = mapped_column(String(120), index=True)
    title: Mapped[str] = mapped_column(String(240))
    discipline: Mapped[str] = mapped_column(String(32), default="other")
    project_type: Mapped[str] = mapped_column(String(32), default="generic")
    lifecycle: Mapped[str] = mapped_column(String(24), default="planned", index=True)
    current_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    latest_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class ProjectRevision(Base):
    __tablename__ = "project_revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    brief_json: Mapped[str] = mapped_column(Text, default="{}")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    source: Mapped[str] = mapped_column(String(24), default="student")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ProjectSubmission(Base):
    __tablename__ = "project_submissions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    source_type: Mapped[str] = mapped_column(String(24))
    source_ref: Mapped[str] = mapped_column(String(1000), default="")
    snapshot_hash: Mapped[str] = mapped_column(String(64), default="")
    manifest_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ProjectEvaluation(Base):
    __tablename__ = "project_evaluations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), index=True)
    submission_id: Mapped[str] = mapped_column(ForeignKey("project_submissions.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(100), default="Waiting for evaluator")
    adapter: Mapped[str] = mapped_column(String(32), default="generic")
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    coverage: Mapped[str] = mapped_column(String(16), default="unknown")
    report_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Opportunity(Base):
    __tablename__ = "opportunities"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_opportunity_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source: Mapped[str] = mapped_column(String(32), index=True)
    external_id: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32), default="hackathon", index=True)
    title: Mapped[str] = mapped_column(String(300))
    organizer: Mapped[str] = mapped_column(String(240), default="")
    locations_json: Mapped[str] = mapped_column(Text, default="[]")
    topics_json: Mapped[str] = mapped_column(Text, default="[]")
    virtual: Mapped[bool] = mapped_column(Boolean, default=False)
    source_date: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    detail_url: Mapped[str] = mapped_column(String(800), default="")
    registration_url: Mapped[str] = mapped_column(String(1200), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    raw_hash: Mapped[str] = mapped_column(String(64))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class StudentOpportunity(Base):
    __tablename__ = "student_opportunities"
    __table_args__ = (UniqueConstraint("student_id", "opportunity_id", name="uq_student_opportunity"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    opportunity_id: Mapped[str] = mapped_column(ForeignKey("opportunities.id"), index=True)
    score: Mapped[float] = mapped_column(Float, default=0)
    reasons_json: Mapped[str] = mapped_column(Text, default="[]")
    # unseen | seen | dismissed | added
    status: Mapped[str] = mapped_column(String(16), default="unseen", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OpportunitySyncRun(Base):
    __tablename__ = "opportunity_sync_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    source: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(16), default="running", index=True)
    fetched_count: Mapped[int] = mapped_column(Integer, default=0)
    changed_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CoopCompany(Base):
    __tablename__ = "coop_companies"
    slug: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str] = mapped_column(String(180))
    overview: Mapped[str] = mapped_column(Text, default="")
    sectors_json: Mapped[str] = mapped_column(Text, default="[]")
    skills_json: Mapped[str] = mapped_column(Text, default="[]")
    tracks_json: Mapped[str] = mapped_column(Text, default="[]")
    locations_json: Mapped[str] = mapped_column(Text, default="[]")
    orientation: Mapped[str] = mapped_column(String(24), default="industry", index=True)
    company_url: Mapped[str] = mapped_column(String(800), default="")
    careers_url: Mapped[str] = mapped_column(String(1200), default="")
    source_url: Mapped[str] = mapped_column(String(1200), default="")
    source_status: Mapped[str] = mapped_column(String(24), default="program_page", index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CoopPosting(Base):
    __tablename__ = "coop_postings"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_coop_posting_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    company_slug: Mapped[str] = mapped_column(ForeignKey("coop_companies.slug"), index=True)
    source: Mapped[str] = mapped_column(String(64), index=True)
    external_id: Mapped[str] = mapped_column(String(180))
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(180), default="")
    skills_json: Mapped[str] = mapped_column(Text, default="[]")
    requirements_json: Mapped[str] = mapped_column(Text, default="[]")
    opens_at: Mapped[str | None] = mapped_column(String(32), nullable=True)
    closes_at: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    detail_url: Mapped[str] = mapped_column(String(1200), default="")
    apply_url: Mapped[str] = mapped_column(String(1200), default="")
    status: Mapped[str] = mapped_column(String(24), default="unknown", index=True)
    source_status: Mapped[str] = mapped_column(String(24), default="program_page")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    raw_hash: Mapped[str] = mapped_column(String(64), default="")
    canonical_key: Mapped[str] = mapped_column(String(64), default="", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # Structured fields a tool-less JSON prompt extracted from the raw posting text (coop_extraction.py):
    # title/company/disciplines/seniority/skill & eligibility requirements/location/duration/apply window.
    # pending | done | failed | skipped (demo postings are never sent to a model).
    extracted_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    extraction_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    extracted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CoopPostingSource(Base):
    __tablename__ = "coop_posting_sources"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_coop_source_external"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    posting_id: Mapped[str] = mapped_column(ForeignKey("coop_postings.id"), index=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    external_id: Mapped[str] = mapped_column(String(220))
    detail_url: Mapped[str] = mapped_column(String(1200), default="")
    apply_url: Mapped[str] = mapped_column(String(1200), default="")
    source_status: Mapped[str] = mapped_column(String(24), default="listed")
    raw_hash: Mapped[str] = mapped_column(String(64), default="")
    metadata_json: Mapped[str] = mapped_column(Text, default="{}")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class StudentCoopState(Base):
    __tablename__ = "student_coop_states"
    __table_args__ = (UniqueConstraint("student_id", "target_type", "target_id", name="uq_student_coop_target"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    target_type: Mapped[str] = mapped_column(String(16), index=True)
    target_id: Mapped[str] = mapped_column(String(180), index=True)
    status: Mapped[str] = mapped_column(String(16), default="saved", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class StudentCoopVisit(Base):
    """When the student last looked at the Co-op view; postings first seen after it are "new"."""
    __tablename__ = "student_coop_visits"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    last_visit_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class CoopRelevance(Base):
    """Cached per (student, posting) Jev decision (coop_relevance.py): relevant/hidden, a fit
    score, a reason grounded in real overlaps, gaps traceable to the posting's own extracted
    requirements, and an eligibility checklist. Recomputed only when student_fingerprint or
    posting_fingerprint changes — never on every page load."""
    __tablename__ = "coop_relevance"
    __table_args__ = (UniqueConstraint("student_id", "posting_id", name="uq_coop_relevance_student_posting"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    posting_id: Mapped[str] = mapped_column(ForeignKey("coop_postings.id"), index=True)
    engine: Mapped[str] = mapped_column(String(24), default="fallback")
    relevant: Mapped[bool] = mapped_column(Boolean, default=True)
    fit_score: Mapped[int] = mapped_column(Integer, default=40)
    reason_text: Mapped[str] = mapped_column(Text, default="")
    hidden_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    matched_json: Mapped[str] = mapped_column(Text, default="[]")
    gaps_json: Mapped[str] = mapped_column(Text, default="[]")
    eligibility_json: Mapped[str] = mapped_column(Text, default="[]")
    target_disciplines_json: Mapped[str] = mapped_column(Text, default="[]")
    student_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    posting_fingerprint: Mapped[str] = mapped_column(String(64), default="")
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AppSetting(Base):
    """Server-wide switches that must survive restarts without touching .env (e.g. decision engine)."""
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class StudentMemory(Base):
    """Something Hermes (or the student) chose to remember about one student across conversations.

    Private to that student and supplemental: it never becomes a StudentFact, never reaches a team
    run, and the student can read, edit and delete every entry in Settings > Memory."""
    __tablename__ = "student_memories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    content: Mapped[str] = mapped_column(String(400))
    # preference | learning | context | other
    category: Mapped[str] = mapped_column(String(24), default="other")
    # hermes | student
    origin: Mapped[str] = mapped_column(String(16), default="hermes")
    source_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class CvDraft(Base):
    """A student's one in-progress CV (app.cv): the full document (template, theme, section order,
    edits) as JSON. Generated content, never a StudentFact — see AGENTS.md."""
    __tablename__ = "cv_drafts"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    document_json: Mapped[str] = mapped_column(Text)
    posting_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class StudentHermesSettings(Base):
    """Per-student switches for what Hermes may remember and which Waypoint connectors it may read."""
    __tablename__ = "student_hermes_settings"
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), primary_key=True)
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Connector ids the student turned off for Hermes (see app.hermes_connectors.CONNECTORS).
    connectors_off_json: Mapped[str] = mapped_column(Text, default="[]")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
