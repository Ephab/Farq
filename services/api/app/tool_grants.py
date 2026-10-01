"""Per-run capabilities for Hermes' student tools.

Hermes only proves it holds the internal token, which every gateway session shares, including the
throwaway JSON sessions that read untrusted CVs, transcripts, portfolio pages, slides and project
briefs. So a student tool also needs a grant: an expiring token Waypoint issues only for a run it
started on purpose (a coach/onboarding chat run or a folder ingest), bound to one student and a set
of scopes. The student comes from the grant, never from an id the model typed. JSON prompts get no
grant, so injected text there cannot record facts, submit evidence or propose roadmap changes.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy import Float, String, delete
from sqlalchemy.orm import Mapped, Session, mapped_column

from .database import Base, get_db
from .internal_auth import require_internal
from .models import AgentRun, Student

READ = "read"
FACTS = "facts"
PROPOSALS = "proposals"
EVIDENCE = "evidence"
PROJECTS = "projects"
COACH_SCOPES = (READ, FACTS, PROPOSALS, PROJECTS)
GRANT_HEADER = "X-Waypoint-Grant"
DEFAULT_TTL_SECONDS = 15 * 60


class HermesToolGrant(Base):
    __tablename__ = "hermes_tool_grants"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    student_id: Mapped[str] = mapped_column(String(36), index=True)
    scopes: Mapped[str] = mapped_column(String(120))
    # Chat runs: the grant dies with the run. Folder ingest: bound to one source instead.
    agent_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    expires: Mapped[float] = mapped_column(Float)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_grant(db: Session, student_id: str, scopes: tuple[str, ...] | list[str], *, agent_run_id: str | None = None,
                source_id: str | None = None, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    db.execute(delete(HermesToolGrant).where(HermesToolGrant.expires <= time.time()))
    token = secrets.token_urlsafe(32)
    db.add(HermesToolGrant(token_hash=_digest(token), student_id=student_id, scopes=",".join(scopes),
                           agent_run_id=agent_run_id, source_id=source_id, expires=time.time() + ttl_seconds))
    db.flush()
    return token


def revoke_grant(db: Session, token: str) -> None:
    db.execute(delete(HermesToolGrant).where(HermesToolGrant.token_hash == _digest(token)))


def check_grant(db: Session, token: str | None, scope: str, claimed_student: str | None = None) -> HermesToolGrant:
    if not token:
        raise HTTPException(403, "This tool needs the grant from the current run header")
    grant = db.get(HermesToolGrant, _digest(token))
    if grant is None or grant.expires <= time.time():
        raise HTTPException(403, "Tool grant expired or unknown")
    if scope not in grant.scopes.split(","):
        raise HTTPException(403, f"This run may not use {scope} tools")
    if grant.agent_run_id is not None:
        run = db.get(AgentRun, grant.agent_run_id)
        if run is None or run.status not in {"queued", "running"}:
            raise HTTPException(403, "The run that owned this grant is no longer active")
    if claimed_student and not _same_student(db, claimed_student, grant.student_id):
        raise HTTPException(403, "This run may only act for its own student")
    return grant


def _same_student(db: Session, claimed: str, student_id: str) -> bool:
    if claimed == student_id:
        return True
    # Models sometimes pass the display name they saw; accept it only if it names this student.
    student = db.get(Student, student_id)
    return student is not None and student.display_name.strip().lower() == claimed.strip().lower()


def grant_dependency(scope: str):
    """FastAPI dependency: internal token + a grant with `scope`. Returns the grant."""

    def dependency(
        db: Annotated[Session, Depends(get_db)],
        _internal: Annotated[None, Depends(require_internal)],
        x_waypoint_grant: Annotated[str | None, Header()] = None,
    ) -> HermesToolGrant:
        return check_grant(db, x_waypoint_grant, scope)

    return dependency


ReadGrant = Annotated[HermesToolGrant, Depends(grant_dependency(READ))]
FactsGrant = Annotated[HermesToolGrant, Depends(grant_dependency(FACTS))]
ProposalsGrant = Annotated[HermesToolGrant, Depends(grant_dependency(PROPOSALS))]
EvidenceGrant = Annotated[HermesToolGrant, Depends(grant_dependency(EVIDENCE))]
ProjectsGrant = Annotated[HermesToolGrant, Depends(grant_dependency(PROJECTS))]


def student_for(db: Session, grant: HermesToolGrant, claimed: str | None) -> str:
    """The grant's student. A model-supplied id that names someone else is refused."""
    if claimed and not _same_student(db, claimed, grant.student_id):
        raise HTTPException(403, "This run may only act for its own student")
    return grant.student_id
