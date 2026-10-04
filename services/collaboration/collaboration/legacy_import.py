"""One-time, opt-in import of a team that lived on a student's machine.

The student's own app builds the bundle and sends it with their bearer token after an explicit confirmation;
nothing here is ever pulled from, or pushed to, a student machine automatically. Rules:

* The importer becomes the only member and the lead. Teammates join through ordinary invitations, so each
  consents to their own membership. Tasks and sections that belonged to others keep a plain-text note of
  the old owner and start unassigned.
* Imported: name, charter, project brief/deliverables/rubric, milestones, tasks, decisions, document sections.
  Never imported: chat, reactions, polls, proposals, Hermes runs, events, student facts, roadmaps or evidence.
* IDs are stable: uuid5 of (importer, kind, source team, local id). Repeating an import is refused with the existing team,
  and no ID a bundle names can collide with another person's rows.
* A dry run validates and counts without writing. The local copy is frozen by the student's app afterwards;
  this service never writes back.
"""
import hashlib
import json
from datetime import datetime, timedelta
from typing import Annotated
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func, select
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .identity import CurrentUser
from .models import now, uid
from .teams.common import Db
from .teams.events import emit
from .teams.models import DocSection, Decision, Milestone, Task, Team, TeamDocument, TeamMember

router = APIRouter()
BUNDLE_VERSION = 1
LIMITS = {"tasks": 500, "sections": 300, "milestones": 60, "decisions": 200, "documents": 12}
IMPORTS_PER_DAY = 5
EXCLUDED = ["chat messages", "reactions and polls", "proposals", "Hermes runs", "activity events", "student facts, roadmaps and evidence"]
TASK_STATUS = {"todo", "doing", "review", "done"}
SECTION_STATUS = {"empty", "draft", "accepted"}
DOC_KINDS = {"srs", "sds", "spmp", "custom"}


class LegacyImport(Base):
    __tablename__ = "legacy_imports"
    __table_args__ = (UniqueConstraint("importer_id", "source_team_id", name="uq_legacy_import_source"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    importer_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    source_team_id: Mapped[str] = mapped_column(String(64))
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"))
    bundle_sha256: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


def clip(limit: int):
    return Field(default="", max_length=limit)


# Local ids are opaque (uuids, but also seeded ones like "sec-falcon-srs-1.1"); they only feed uuid5.
Ident = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")


class BMember(BaseModel):
    local_user_id: str = Ident
    display_name: str = Field(max_length=120)
    is_lead: bool = False


class BMilestone(BaseModel):
    id: str = Ident
    title: str = Field(min_length=1, max_length=160)
    due: datetime | None = None
    deliverable_key: str | None = Field(default=None, max_length=24)
    completed_at: datetime | None = None


class BTask(BaseModel):
    id: str = Ident
    title: str = Field(min_length=1, max_length=200)
    description: str = clip(20_000)
    status: str = "todo"
    assignee_local_id: str | None = Field(default=None, max_length=64)
    estimate_points: int = Field(default=1, ge=1, le=8)
    due: datetime | None = None
    depends_on: list[Annotated[str, Field(max_length=64)]] = Field(default_factory=list, max_length=50)
    milestone_id: str | None = Field(default=None, max_length=64)
    rationale: str = clip(5_000)
    position: float = 0

    @field_validator("status")
    @classmethod
    def known_status(cls, value):
        if value not in TASK_STATUS:
            raise ValueError("unknown task status")
        return value


class BDecision(BaseModel):
    id: str = Ident
    text: str = Field(min_length=1, max_length=5_000)


class BSection(BaseModel):
    id: str = Ident
    key: str = Field(min_length=1, max_length=16)
    title: str = Field(max_length=160)
    position: int = Field(default=0, ge=0, le=10_000)
    owner_local_id: str | None = Field(default=None, max_length=64)
    content_md: str = clip(200_000)
    status: str = "empty"

    @field_validator("status")
    @classmethod
    def known_status(cls, value):
        if value not in SECTION_STATUS:
            raise ValueError("unknown section status")
        return value


class BDocument(BaseModel):
    id: str = Ident
    kind: str
    title: str = Field(min_length=1, max_length=160)
    sections: list[BSection] = Field(default_factory=list, max_length=LIMITS["sections"])

    @field_validator("kind")
    @classmethod
    def known_kind(cls, value):
        if value not in DOC_KINDS:
            raise ValueError("unknown document kind")
        return value


class Bundle(BaseModel):
    version: int
    source_team_id: str = Ident
    name: str = Field(min_length=2, max_length=80)
    charter: dict = Field(default_factory=dict)
    project: dict = Field(default_factory=dict)
    members: list[BMember] = Field(default_factory=list, max_length=60)
    milestones: list[BMilestone] = Field(default_factory=list, max_length=LIMITS["milestones"])
    tasks: list[BTask] = Field(default_factory=list, max_length=LIMITS["tasks"])
    decisions: list[BDecision] = Field(default_factory=list, max_length=LIMITS["decisions"])
    documents: list[BDocument] = Field(default_factory=list, max_length=LIMITS["documents"])


class ImportInput(BaseModel):
    bundle: Bundle
    importer_local_id: str = Ident  # which bundle member is the caller
    dry_run: bool = True


def stable(importer: str, kind: str, local: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"waypoint-legacy:{importer}:{kind}:{local}"))


def summary(bundle: Bundle) -> dict:
    counts = {"tasks": len(bundle.tasks), "milestones": len(bundle.milestones), "decisions": len(bundle.decisions),
              "documents": len(bundle.documents), "sections": sum(len(item.sections) for item in bundle.documents)}
    return {"counts": counts, "excluded": EXCLUDED}


def check(bundle: Bundle, importer_local_id: str) -> list[str]:
    problems = []
    if bundle.version != BUNDLE_VERSION:
        problems.append(f"Unsupported bundle version {bundle.version}")
    members = {member.local_user_id for member in bundle.members}
    if importer_local_id not in members:
        problems.append("You are not a member of the team being moved")
    lead = next((member.local_user_id for member in bundle.members if member.is_lead), None)
    if lead != importer_local_id:
        problems.append("Only the team's lead can move it to the shared service")
    for kind, items in (("task", bundle.tasks), ("milestone", bundle.milestones), ("decision", bundle.decisions)):
        if len({item.id for item in items}) != len(items):
            problems.append(f"Duplicate {kind} ids")
    if len({section.id for document in bundle.documents for section in document.sections}) != sum(len(d.sections) for d in bundle.documents):
        problems.append("Duplicate section ids")
    milestone_ids = {item.id for item in bundle.milestones}
    task_ids = {item.id for item in bundle.tasks}
    if any(task.milestone_id and task.milestone_id not in milestone_ids for task in bundle.tasks):
        problems.append("A task points at a missing milestone")
    if any(dep not in task_ids for task in bundle.tasks for dep in task.depends_on):
        problems.append("A task depends on a missing task")
    return problems


@router.post("/v1/teams/import")
def import_team(body: ImportInput, db: Db, user: CurrentUser):
    bundle = body.bundle
    problems = check(bundle, body.importer_local_id)
    if problems:
        raise HTTPException(422, "; ".join(problems))
    digest = hashlib.sha256(bundle.model_dump_json().encode()).hexdigest()
    existing = db.scalar(select(LegacyImport).where(LegacyImport.importer_id == user.id, LegacyImport.source_team_id == bundle.source_team_id))
    if existing is not None:
        raise HTTPException(409, f"This team was already moved (shared project {existing.team_id})")
    result = summary(bundle) | {"dry_run": body.dry_run, "name": bundle.name,
                                "unassigned_to_invite": sorted(m.display_name for m in bundle.members if m.local_user_id != body.importer_local_id)}
    if body.dry_run:
        return result
    recent = db.scalar(select(func.count()).select_from(LegacyImport).where(
        LegacyImport.importer_id == user.id, LegacyImport.created_at > now() - timedelta(days=1)))
    if recent >= IMPORTS_PER_DAY:
        raise HTTPException(429, "Too many team moves today; try again tomorrow")

    sid = lambda kind, local: stable(user.id, kind, f"{bundle.source_team_id}:{local}")  # noqa: E731
    names = {member.local_user_id: member.display_name for member in bundle.members}
    mine = body.importer_local_id
    team = Team(id=sid("team", bundle.source_team_id), name=bundle.name.strip(), assignment_id=None, lead_user_id=user.id,
                cover_seed=hashlib.sha256(sid("cover", bundle.source_team_id).encode()).hexdigest()[:12],
                charter_json=json.dumps(bundle.charter, ensure_ascii=False),
                brief_json=json.dumps(bundle.project.get("brief", {}), ensure_ascii=False),
                deliverables_json=json.dumps(bundle.project.get("deliverables", []), ensure_ascii=False),
                rubric_json=json.dumps(bundle.project.get("rubric", []), ensure_ascii=False))
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id, role_label="Lead"))
    for item in bundle.milestones:
        db.add(Milestone(id=sid("milestone", item.id), team_id=team.id, title=item.title, due=item.due,
                         deliverable_key=item.deliverable_key, completed_at=item.completed_at))
    db.flush()
    for item in bundle.tasks:
        note = ""
        if item.assignee_local_id and item.assignee_local_id != mine:
            note = f"\n\n(Imported: previously assigned to {names.get(item.assignee_local_id, 'a former teammate')}.)"
        db.add(Task(id=sid("task", item.id), team_id=team.id, title=item.title, description=item.description + note, status=item.status,
                    assignee_id=user.id if item.assignee_local_id == mine else None, estimate_points=item.estimate_points, due=item.due,
                    depends_on_json=json.dumps([sid("task", dep) for dep in item.depends_on]),
                    milestone_id=sid("milestone", item.milestone_id) if item.milestone_id else None,
                    rationale=item.rationale, created_by="user", position=item.position))
    for item in bundle.decisions:
        db.add(Decision(id=sid("decision", item.id), team_id=team.id, text=item.text, pinned_by=user.id))
    for document in bundle.documents:
        db.add(TeamDocument(id=sid("document", document.id), team_id=team.id, kind=document.kind, title=document.title))
        db.flush()
        for section in document.sections:
            former = names.get(section.owner_local_id) if section.owner_local_id and section.owner_local_id != mine else None
            db.add(DocSection(id=sid("section", section.id), document_id=sid("document", document.id), key=section.key, title=section.title,
                              position=section.position, owner_user_id=user.id if section.owner_local_id == mine else None,
                              content_md=section.content_md, status=section.status, version=1 if section.content_md else 0,
                              meta_json=json.dumps({"imported_owner": former} if former else {})))
    db.add(LegacyImport(importer_id=user.id, source_team_id=bundle.source_team_id, team_id=team.id, bundle_sha256=digest))
    emit(db, team.id, "team.imported", user.id, result["counts"])
    db.commit()
    return result | {"team_id": team.id}
