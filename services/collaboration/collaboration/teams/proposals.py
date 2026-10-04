from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..identity import CurrentUser, User
from ..models import now
from .chat import post_message
from .common import Db, aware, iso, loads, lock_for_write, project_dict, require, require_team, utc
from .docs import lock_active, new_document, section_dict
from .events import emit
from .models import DocSection, Milestone, Task, Team, TeamDocument, TeamEvent, TeamMember, TeamProposal
from .policy import authorize
from .tasks import _next_position, _sync_milestone, assert_acyclic, milestone_dict, remove_task, task_dict

router = APIRouter()
EXPIRY = timedelta(hours=48)
BALANCE_SHARE = 0.2
BALANCE_FLOOR = 2


class ProposalError(ValueError):
    """A proposal that cannot be stored or applied, with a reason Hermes can act on."""


class SplitTask(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    assignee_id: str
    estimate_points: int = Field(ge=1, le=8)
    milestone_id: str | None = None
    depends_on: list[str] = Field(default_factory=list, max_length=10)
    rationale: str = Field(min_length=1, max_length=600)


class TaskSplitPayload(BaseModel):
    tasks: list[SplitTask] = Field(min_length=1, max_length=20)


class TaskChanges(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    estimate_points: int | None = Field(default=None, ge=1, le=8)
    assignee_id: str | None = None

    @model_validator(mode="after")
    def changes_something(self) -> "TaskChanges":
        if not self.model_fields_set:
            raise ValueError("A task edit must change something")
        # Only the assignee may be cleared; a null title/description/points would corrupt the task.
        for field in ("title", "description", "estimate_points"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TaskEditPayload(BaseModel):
    task_id: str
    changes: TaskChanges
    rationale: str = Field(default="", max_length=600)


class TaskDeletePayload(BaseModel):
    task_ids: list[str] = Field(min_length=1, max_length=20)
    rationale: str = Field(min_length=1, max_length=600)


class ReorgChange(BaseModel):
    task_id: str
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    estimate_points: int | None = Field(default=None, ge=1, le=8)
    assignee_id: str | None = None
    milestone_id: str | None = None

    @model_validator(mode="after")
    def changes_something(self) -> "ReorgChange":
        fields = self.model_fields_set - {"task_id"}
        if not fields:
            raise ValueError("A reorganization change must change something")
        for field in ("title", "description", "estimate_points"):
            if field in fields and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TaskReorganizePayload(BaseModel):
    """Re-split existing to-do work in one vote: change, delete and add tasks together."""

    changes: list[ReorgChange] = Field(default_factory=list, max_length=30)
    deletes: list[str] = Field(default_factory=list, max_length=20)
    adds: list[SplitTask] = Field(default_factory=list, max_length=20)
    rationale: str = Field(min_length=1, max_length=600)

    @model_validator(mode="after")
    def does_something(self) -> "TaskReorganizePayload":
        if not (self.changes or self.deletes or self.adds):
            raise ValueError("A reorganization must change, delete or add at least one task")
        changed = [change.task_id for change in self.changes]
        if len(set(changed)) != len(changed) or set(changed) & set(self.deletes):
            raise ValueError("Each task may appear once, either changed or deleted")
        return self


class DocSectionPayload(BaseModel):
    section_id: str
    content_md: str = Field(min_length=1, max_length=20000)
    requirement_ids: list[str] = Field(default_factory=list, max_length=50)


class CharterModel(BaseModel):
    goal: str = Field(min_length=1, max_length=400)
    roles: dict[str, str] = Field(default_factory=dict)
    working_agreement: list[str] = Field(default_factory=list, max_length=10)
    meetings: str = Field(default="", max_length=120)


class CharterPayload(BaseModel):
    charter: CharterModel


class NewMilestone(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    due: datetime | None = None
    deliverable_key: str | None = Field(default=None, max_length=24)


class MilestonesPayload(BaseModel):
    milestones: list[NewMilestone] = Field(min_length=1, max_length=10)


class SectionOwnersPayload(BaseModel):
    owners: dict[str, str] = Field(min_length=1, max_length=60)


class MergeInto(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    estimate_points: int = Field(ge=1, le=8)
    # Left unset, the merged task keeps the first task's assignee / milestone.
    assignee_id: str | None = None
    milestone_id: str | None = None


class TaskMergePayload(BaseModel):
    """Compress several to-do tasks into one: the first is kept and rewritten, the rest removed."""

    task_ids: list[str] = Field(min_length=2, max_length=10)
    into: MergeInto
    rationale: str = Field(min_length=1, max_length=600)

    @model_validator(mode="after")
    def distinct(self) -> "TaskMergePayload":
        if len(set(self.task_ids)) != len(self.task_ids):
            raise ValueError("Each task may appear once in a merge")
        return self


class BriefPayload(BaseModel):
    problem: str = Field(default="", max_length=3000)
    objective: str = Field(default="", max_length=3000)
    scope: str = Field(default="", max_length=3000)
    constraints: list[str] = Field(default_factory=list, max_length=20)
    tools: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def says_something(self) -> "BriefPayload":
        if not (self.problem.strip() or self.objective.strip() or self.scope.strip()):
            raise ValueError("A brief needs a problem, objective or scope")
        return self


class Deliverable(BaseModel):
    key: str = Field(min_length=1, max_length=24, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    title: str = Field(min_length=1, max_length=200)
    due: datetime | None = None
    doc_kind: Literal["srs", "sds", "spmp"] | None = None


class DeliverablesPayload(BaseModel):
    deliverables: list[Deliverable] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def unique_keys(self) -> "DeliverablesPayload":
        keys = [item.key for item in self.deliverables]
        if len(set(keys)) != len(keys):
            raise ValueError("Deliverable keys must be unique")
        return self


class Criterion(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    weight: int = Field(ge=0, le=100)
    description: str = Field(default="", max_length=600)


class RubricPayload(BaseModel):
    criteria: list[Criterion] = Field(min_length=1, max_length=12)


class BatchOp(BaseModel):
    kind: str
    payload: dict


class BatchPayload(BaseModel):
    """Many operations, one vote, applied all-or-nothing in order."""

    ops: list[BatchOp] = Field(min_length=1, max_length=25)
    rationale: str = Field(default="", max_length=600)


PAYLOADS: dict[str, type[BaseModel]] = {
    "task_split": TaskSplitPayload, "task_edit": TaskEditPayload, "task_delete": TaskDeletePayload,
    "task_reorganize": TaskReorganizePayload, "task_merge": TaskMergePayload, "doc_section": DocSectionPayload,
    "charter": CharterPayload, "milestones": MilestonesPayload, "section_owners": SectionOwnersPayload,
    "brief": BriefPayload, "deliverables": DeliverablesPayload, "rubric": RubricPayload, "batch": BatchPayload,
}
TASK_KINDS = {"task_split", "task_edit", "task_delete", "task_reorganize", "task_merge"}
# Kinds that only ever store fields Hermes set, so applying never writes the unset ones as null.
SPARSE_KINDS = {"task_edit", "task_reorganize", "task_merge"}


class VoteInput(BaseModel):
    vote: Literal["up", "down"]


def members_of(db: Session, team_id: str) -> list[str]:
    return list(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team_id).order_by(TeamMember.joined_at)))


def proposal_dict(proposal: TeamProposal) -> dict:
    return {
        "id": proposal.id, "team_id": proposal.team_id, "scope": proposal.scope, "affected_user_id": proposal.affected_user_id,
        "kind": proposal.kind, "summary": proposal.summary, "payload": loads(proposal.payload_json, {}), "status": proposal.status,
        "votes": loads(proposal.votes_json, {}), "invoked_by": proposal.invoked_by, "created_at": iso(proposal.created_at),
        "expires_at": iso(proposal.expires_at), "decided_at": iso(proposal.decided_at), "decided_by": proposal.decided_by,
        "decided_via": proposal.decided_via, "warnings": loads(proposal.warnings_json, []),
    }


def _parse(kind: str, payload: dict) -> BaseModel:
    model = PAYLOADS.get(kind)
    if model is None:
        raise ProposalError(f"Unknown proposal kind {kind!r}")
    try:
        return model.model_validate(payload)
    except ValidationError as error:
        first = error.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise ProposalError(f"Invalid {kind} payload: {first['msg']} at {where}") from error


def _team_section(db: Session, team: Team, section_id: str) -> DocSection:
    section = db.get(DocSection, section_id)
    document = db.get(TeamDocument, section.document_id) if section else None
    if section is None or document is None or document.team_id != team.id:
        raise ProposalError(f"Section {section_id} is not in this team")
    return section


def _todo_task(db: Session, team: Team, task_id: str) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.team_id != team.id:
        raise ProposalError(f"Task {task_id} is not in this team")
    if task.status != "todo":
        raise ProposalError(f"Task {task.title!r} is {task.status}; only to-do tasks can be changed by a proposal")
    return task


def _check_new_tasks(db: Session, team: Team, items: list[SplitTask], members: list[str], known: set[str]) -> None:
    for item in items:
        if item.assignee_id not in members:
            raise ProposalError(f"{item.assignee_id} is not a member of this team")
        if item.milestone_id is not None:
            milestone = db.get(Milestone, item.milestone_id)
            if milestone is None or milestone.team_id != team.id:
                raise ProposalError(f"Unknown milestone {item.milestone_id}")
        if set(item.depends_on) - known:
            raise ProposalError("depends_on must list existing task ids in this team")


def _team_milestone(db: Session, team: Team, milestone_id: str | None) -> None:
    if milestone_id is None:
        return
    milestone = db.get(Milestone, milestone_id)
    if milestone is None or milestone.team_id != team.id:
        raise ProposalError(f"Unknown milestone {milestone_id}")


def balance_warning(db: Session, team: Team) -> str | None:
    """Advisory only: the team (or the lead) decides whether an uneven board is fine."""
    members = members_of(db, team.id)
    if not members:
        return None
    load = {member: 0 for member in members}
    for task in db.scalars(select(Task).where(Task.team_id == team.id, Task.status != "done")).all():
        if task.assignee_id in load:
            load[task.assignee_id] += task.estimate_points
    mean = sum(load.values()) / len(load)
    tolerance = max(BALANCE_FLOOR, BALANCE_SHARE * mean)
    if any(abs(points - mean) > tolerance for points in load.values()):
        names = {user.id: user.display_name for user in db.scalars(select(User).where(User.id.in_(members))).all()}
        spread = ", ".join(f"{names.get(member, member)} {points}" for member, points in load.items())
        return f"Uneven workload: open points per member would be {spread} (average {mean:.1f})"
    return None


def check(db: Session, team: Team, kind: str, model: BaseModel, invoked_by: str | None) -> tuple[str, str | None]:
    """Validate against the team as it is now. Returns (scope, affected_user_id)."""
    members = members_of(db, team.id)
    if kind == "task_split":
        tasks = db.scalars(select(Task).where(Task.team_id == team.id)).all()
        _check_new_tasks(db, team, model.tasks, members, {task.id for task in tasks})
        missing = [member for member in members if not any(item.assignee_id == member for item in model.tasks)]
        if missing:
            raise ProposalError(f"Every member needs at least one task; none for: {', '.join(missing)}")
        return "team", None
    if kind == "task_delete":
        for task_id in model.task_ids:
            _todo_task(db, team, task_id)
        return "team", None
    if kind == "task_reorganize":
        tasks = db.scalars(select(Task).where(Task.team_id == team.id)).all()
        for task_id in [*(change.task_id for change in model.changes), *model.deletes]:
            _todo_task(db, team, task_id)
        for change in model.changes:
            if change.assignee_id is not None and change.assignee_id not in members:
                raise ProposalError(f"{change.assignee_id} is not a member of this team")
            _team_milestone(db, team, change.milestone_id)
        _check_new_tasks(db, team, model.adds, members, {task.id for task in tasks} - set(model.deletes))
        return "team", None
    if kind == "task_merge":
        for task_id in model.task_ids:
            _todo_task(db, team, task_id)
        if model.into.assignee_id is not None and model.into.assignee_id not in members:
            raise ProposalError(f"{model.into.assignee_id} is not a member of this team")
        _team_milestone(db, team, model.into.milestone_id)
        return "team", None
    if kind in ("brief", "deliverables", "rubric"):
        return "team", None
    if kind == "task_edit":
        task = db.get(Task, model.task_id)
        if task is None or task.team_id != team.id:
            raise ProposalError(f"Task {model.task_id} is not in this team")
        if task.status != "todo":
            raise ProposalError(f"Task {task.title!r} is {task.status}; only to-do tasks can be changed by a proposal")
        if model.changes.assignee_id is not None and model.changes.assignee_id not in members:
            raise ProposalError(f"{model.changes.assignee_id} is not a member of this team")
        return ("personal", task.assignee_id) if task.assignee_id else ("team", None)
    if kind == "doc_section":
        section = _team_section(db, team, model.section_id)
        if lock_active(section, now()):
            raise ProposalError(f"Section {section.key} is being edited right now")
        return "personal", section.owner_user_id or invoked_by
    if kind == "charter":
        strangers = set(model.charter.roles) - set(members)
        if strangers:
            raise ProposalError(f"Roles name people who are not in the team: {', '.join(sorted(strangers))}")
        return "team", None
    if kind == "milestones":
        return "team", None
    if kind == "section_owners":
        for section_id, owner in model.owners.items():
            _team_section(db, team, section_id)
            if owner not in members:
                raise ProposalError(f"{owner} is not a member of this team")
        return "team", None
    raise ProposalError(f"Unknown proposal kind {kind!r}")


def _ops(kind: str, model: BaseModel) -> list[tuple[str, BaseModel]]:
    """A proposal as its ordered operations: a batch's parsed steps, or the proposal itself."""
    if kind != "batch":
        return [(kind, model)]
    ops = []
    for index, op in enumerate(model.ops, 1):
        if op.kind == "batch":
            raise ProposalError(f"Step {index}: a batch cannot contain another batch")
        try:
            ops.append((op.kind, _parse(op.kind, op.payload)))
        except ProposalError as error:
            raise ProposalError(f"Step {index}: {error}") from error
    return ops


def _dump(kind: str, model: BaseModel) -> dict:
    return model.model_dump(mode="json", exclude_unset=kind in SPARSE_KINDS)


def _stored_payload(kind: str, model: BaseModel) -> str:
    if kind != "batch":
        return json.dumps(_dump(kind, model))
    ops = [{"kind": op_kind, "payload": _dump(op_kind, op_model)} for op_kind, op_model in _ops(kind, model)]
    return json.dumps({"ops": ops, "rationale": model.rationale})


def _run(db: Session, team: Team, kind: str, model: BaseModel, invoked_by: str | None, actor: str | None,
         base_seq: int | None = None) -> tuple[str, str | None]:
    """Check then apply each step in order, so later steps see earlier ones. Returns (scope, affected_user_id):
    personal only when every step is personal for the same member. The caller owns the savepoint."""
    ops = _ops(kind, model)
    until_seq = db.scalar(select(func.max(TeamEvent.seq)).where(TeamEvent.team_id == team.id)) or 0
    scopes: set[tuple[str, str | None]] = set()
    for index, (op_kind, op_model) in enumerate(ops, 1):
        try:
            scopes.add(check(db, team, op_kind, op_model, invoked_by))
            if (base_seq is not None and op_kind == "doc_section"
                    and _section_changed_since(db, team, op_model.section_id, base_seq, until_seq)):
                raise ProposalError("A teammate changed this section after the draft was written")
            _apply_op(db, team, op_kind, op_model, actor)
        except ProposalError as error:
            raise ProposalError(f"Step {index} ({op_kind}): {error}" if len(ops) > 1 else str(error)) from error
    if len(scopes) == 1 and next(iter(scopes))[0] == "personal":
        return next(iter(scopes))
    return "team", None


def _warnings(db: Session, team: Team, ops: list[tuple[str, BaseModel]]) -> list[str]:
    """Read on the simulated board, before the savepoint rolls back."""
    warnings = []
    if any(op_kind in TASK_KINDS for op_kind, _ in ops):
        warning = balance_warning(db, team)
        if warning:
            warnings.append(warning)
    for op_kind, op_model in ops:
        if op_kind == "rubric":
            total = sum(item.weight for item in op_model.criteria)
            if total != 100:
                warnings.append(f"Rubric weights add up to {total}, not 100")
    return warnings


def _simulate(db: Session, team: Team, kind: str, model: BaseModel, invoked_by: str | None) -> tuple[tuple[str, str | None], list[str]]:
    lock_for_write(db)
    savepoint = db.begin_nested()
    try:
        scope = _run(db, team, kind, model, invoked_by, invoked_by)
        warnings = _warnings(db, team, _ops(kind, model))
    finally:
        savepoint.rollback()
    return scope, warnings


def create_proposal(db: Session, team: Team, kind: str, payload: dict, *, summary: str, invoked_by: str | None, run_id: str | None = None) -> TeamProposal:
    """Validate by applying it in a rolled-back savepoint, then store a pending proposal plus its chat card.
    The caller commits."""
    model = _parse(kind, payload)
    ops = _ops(kind, model)
    # Checked only at creation (not re-checked at apply): a fresh split must not stack
    # duplicates on an existing board; task_reorganize can change, delete and add in one vote.
    if any(op_kind == "task_split" for op_kind, _ in ops) and db.scalar(select(Task.id).where(Task.team_id == team.id, Task.status == "todo").limit(1)):
        raise ProposalError("The board already has To do tasks; re-split them with kind task_reorganize "
                            "(task_changes, task_ids to delete, tasks to add) instead of a new task_split")
    base_seq = db.scalar(select(func.max(TeamEvent.seq)).where(TeamEvent.team_id == team.id)) or 0
    (scope, affected), warnings = _simulate(db, team, kind, model, invoked_by)
    proposal = TeamProposal(
        team_id=team.id, scope=scope, affected_user_id=affected, kind=kind,
        summary=(summary.strip() or kind.replace("_", " "))[:240],
        payload_json=_stored_payload(kind, model), warnings_json=json.dumps(warnings),
        base_seq=base_seq, invoked_by=invoked_by, run_id=run_id, expires_at=now() + EXPIRY,
    )
    db.add(proposal)
    db.flush()
    emit(db, team.id, "proposal.created", None, proposal_dict(proposal))
    post_message(db, team.id, None, proposal.summary, kind="proposal", metadata={"proposal_id": proposal.id})
    return proposal


def _close(db: Session, team: Team, proposal: TeamProposal, status: str, actor: str | None, extra: dict | None = None) -> None:
    proposal.status = status
    proposal.decided_at = now()
    proposal.decided_by = actor
    emit(db, team.id, f"proposal.{status}", actor, {**proposal_dict(proposal), **(extra or {})})


def _section_changed_since(db: Session, team: Team, section_id: str, base_seq: int, until_seq: int) -> bool:
    """Only edits between the proposal and this apply count, not ones made by earlier steps of the same batch."""
    updates = db.scalars(select(TeamEvent.payload_json).where(
        TeamEvent.team_id == team.id, TeamEvent.seq > base_seq, TeamEvent.seq <= until_seq, TeamEvent.type == "section.updated",
    )).all()
    return any(loads(payload, {}).get("id") == section_id for payload in updates)


def _create_tasks(db: Session, team: Team, items: list[SplitTask], actor: str | None) -> None:
    touched: set[str] = set()
    for item in items:
        task = Task(
            team_id=team.id, title=item.title.strip(), description=item.description, assignee_id=item.assignee_id,
            estimate_points=item.estimate_points, milestone_id=item.milestone_id, depends_on_json=json.dumps(item.depends_on),
            rationale=item.rationale, created_by="hermes", position=_next_position(db, team.id, "todo"),
        )
        db.add(task)
        db.flush()
        emit(db, team.id, "task.created", actor, task_dict(task))
        if item.milestone_id:
            touched.add(item.milestone_id)
    for milestone_id in touched:
        _sync_milestone(db, team.id, milestone_id, actor)


def _merge_tasks(db: Session, team: Team, model: TaskMergePayload, actor: str | None) -> None:
    tasks = [db.get(Task, task_id) for task_id in model.task_ids]
    kept, removed = tasks[0], tasks[1:]
    removed_ids = {task.id for task in removed}
    merged_ids = removed_ids | {kept.id}
    depends_on: list[str] = []
    for task in tasks:
        for dependency in loads(task.depends_on_json, []):
            if dependency not in merged_ids and dependency not in depends_on:
                depends_on.append(dependency)
    graph = {}
    repointed = []
    for other in db.scalars(select(Task).where(Task.team_id == team.id)).all():
        if other.id in merged_ids:
            continue
        dependencies = loads(other.depends_on_json, [])
        if removed_ids & set(dependencies):
            dependencies = list(dict.fromkeys(kept.id if item in removed_ids else item for item in dependencies))
            repointed.append((other, dependencies))
        graph[other.id] = dependencies
    graph[kept.id] = depends_on
    try:
        assert_acyclic(graph)
    except ValueError as error:
        raise ProposalError(str(error)) from error
    previous_milestones = {task.milestone_id for task in tasks}
    for other, dependencies in repointed:
        other.depends_on_json = json.dumps(dependencies)
        other.updated_at = now()
        db.flush()
        emit(db, team.id, "task.updated", actor, task_dict(other))
    into = model.into
    kept.title, kept.description, kept.estimate_points = into.title.strip(), into.description, into.estimate_points
    if "assignee_id" in into.model_fields_set:
        kept.assignee_id = into.assignee_id
    if "milestone_id" in into.model_fields_set:
        kept.milestone_id = into.milestone_id
    kept.depends_on_json = json.dumps(depends_on)
    kept.rationale = model.rationale
    kept.updated_at = now()
    db.flush()
    emit(db, team.id, "task.updated", actor, task_dict(kept))
    for task in removed:
        remove_task(db, team.id, task, actor)
    for milestone_id in previous_milestones | {kept.milestone_id}:
        _sync_milestone(db, team.id, milestone_id, actor)


def _set_project(db: Session, team: Team, actor: str | None, **fields: str) -> None:
    for column, value in fields.items():
        setattr(team, column, value)
    db.flush()
    emit(db, team.id, "team.updated", actor, {"project": project_dict(team)})


def _apply_op(db: Session, team: Team, kind: str, model: BaseModel, actor: str | None) -> None:
    if kind == "task_split":
        _create_tasks(db, team, model.tasks, actor)
    elif kind == "task_delete":
        for task_id in model.task_ids:
            remove_task(db, team.id, db.get(Task, task_id), actor)
    elif kind == "task_reorganize":
        for change in model.changes:
            task = db.get(Task, change.task_id)
            previous_milestone = task.milestone_id
            for field in change.model_fields_set - {"task_id"}:
                setattr(task, field, getattr(change, field))
            task.updated_at = now()
            db.flush()
            emit(db, team.id, "task.updated", actor, task_dict(task))
            _sync_milestone(db, team.id, previous_milestone, actor)
            if task.milestone_id != previous_milestone:
                _sync_milestone(db, team.id, task.milestone_id, actor)
        for task_id in model.deletes:
            remove_task(db, team.id, db.get(Task, task_id), actor)
        _create_tasks(db, team, model.adds, actor)
    elif kind == "task_merge":
        _merge_tasks(db, team, model, actor)
    elif kind == "task_edit":
        task = db.get(Task, model.task_id)
        for field in model.changes.model_fields_set:
            setattr(task, field, getattr(model.changes, field))
        task.updated_at = now()
        db.flush()
        emit(db, team.id, "task.updated", actor, task_dict(task))
    elif kind == "doc_section":
        section = db.get(DocSection, model.section_id)
        section.content_md = model.content_md
        section.status = "accepted"
        section.version += 1
        meta = loads(section.meta_json, {})
        meta.update({"requirement_ids": model.requirement_ids, "drafted_by": "hermes"})
        section.meta_json = json.dumps(meta)
        emit(db, team.id, "section.updated", actor, section_dict(section))
    elif kind == "charter":
        team.charter_json = model.charter.model_dump_json()
        emit(db, team.id, "team.updated", actor, {"charter": model.charter.model_dump()})
    elif kind == "milestones":
        for item in model.milestones:
            milestone = Milestone(team_id=team.id, title=item.title.strip(), due=utc(item.due), deliverable_key=item.deliverable_key)
            db.add(milestone)
            db.flush()
            emit(db, team.id, "milestone.created", actor, milestone_dict(milestone))
    elif kind == "section_owners":
        for section_id, owner in model.owners.items():
            section = db.get(DocSection, section_id)
            section.owner_user_id = owner
            emit(db, team.id, "section.updated", actor, section_dict(section))
    elif kind == "brief":
        _set_project(db, team, actor, brief_json=model.model_dump_json())
    elif kind == "deliverables":
        _set_project(db, team, actor, deliverables_json=json.dumps([item.model_dump(mode="json") for item in model.deliverables]))
        existing = set(db.scalars(select(TeamDocument.kind).where(TeamDocument.team_id == team.id)).all())
        for doc_kind in dict.fromkeys(item.doc_kind for item in model.deliverables if item.doc_kind):
            if doc_kind not in existing:
                new_document(db, team.id, doc_kind, actor)
    elif kind == "rubric":
        _set_project(db, team, actor, rubric_json=json.dumps([item.model_dump() for item in model.criteria]))
    else:
        raise ProposalError(f"Unknown proposal kind {kind!r}")


def apply_proposal(db: Session, team: Team, proposal: TeamProposal, actor: str) -> None:
    """Re-check against the current team and write every step in this transaction, or roll all of them
    back and mark the proposal stale: a batch is never half-applied."""
    model = PAYLOADS[proposal.kind].model_validate_json(proposal.payload_json)
    savepoint = db.begin_nested()
    try:
        scope = _run(db, team, proposal.kind, model, proposal.invoked_by, actor, base_seq=proposal.base_seq)
        if scope != (proposal.scope, proposal.affected_user_id):
            raise ProposalError("The task or section changed hands since this was proposed")
    except ProposalError as error:
        savepoint.rollback()
        _close(db, team, proposal, "stale", actor, {"reason": str(error)})
        return
    savepoint.commit()
    _close(db, team, proposal, "applied", actor)


def expire_stalled(db: Session, team: Team) -> None:
    """Lazy 48 h fallback: stalled team votes wait for the lead (spec §2)."""
    at = now()
    for proposal in db.scalars(select(TeamProposal).where(
        TeamProposal.team_id == team.id, TeamProposal.status == "pending", TeamProposal.scope == "team",
    )).all():
        if aware(proposal.expires_at) <= at:
            proposal.status = "awaiting_lead"
            emit(db, team.id, "proposal.awaiting_lead", None, proposal_dict(proposal))


def _load(db: Session, proposal_id: str, user: User) -> tuple[TeamProposal, Team]:
    lock_for_write(db)
    proposal = require(db, TeamProposal, proposal_id, "Proposal")
    team = require_team(db, proposal.team_id)
    authorize(db, user, team, "write")
    expire_stalled(db, team)
    return proposal, team


@router.post("/v1/proposals/{proposal_id}/vote")
def vote_on_proposal(proposal_id: str, body: VoteInput, db: Db, user: CurrentUser) -> dict:
    proposal, team = _load(db, proposal_id, user)
    if proposal.scope != "team" or proposal.status != "pending":
        raise HTTPException(409, "This proposal is not open for voting")
    votes = loads(proposal.votes_json, {})
    votes[user.id] = body.vote
    proposal.votes_json = json.dumps(votes)
    members = members_of(db, team.id)
    ups = sum(1 for member in members if votes.get(member) == "up")
    downs = sum(1 for member in members if votes.get(member) == "down")
    emit(db, team.id, "proposal.voted", user.id, proposal_dict(proposal))
    if ups * 2 > len(members):
        apply_proposal(db, team, proposal, user.id)
    elif (len(members) - downs) * 2 <= len(members):
        _close(db, team, proposal, "rejected", user.id)
    db.commit()
    return proposal_dict(proposal)


def _decide(proposal_id: str, db: Session, user: User, accept: bool) -> dict:
    """The affected member decides a personal proposal and the lead a stalled vote. The lead may also
    decide any other open proposal directly; that is recorded as a lead override on the event."""
    proposal, team = _load(db, proposal_id, user)
    is_lead = team.lead_user_id == user.id
    if proposal.status not in ("pending", "awaiting_lead"):
        raise HTTPException(409, "This proposal is not waiting for a decision")
    if proposal.status == "pending" and proposal.scope == "personal" and proposal.affected_user_id == user.id:
        proposal.decided_via = None
    elif proposal.status == "awaiting_lead" and is_lead:
        proposal.decided_via = None
    elif is_lead:
        proposal.decided_via = "lead_override"
    elif proposal.status == "pending" and proposal.scope == "personal":
        raise HTTPException(403, "Only the member this proposal affects, or the team lead, can decide it")
    elif proposal.status == "awaiting_lead":
        raise HTTPException(403, "Only the team lead can decide a stalled vote")
    else:
        raise HTTPException(409, "This proposal is decided by a team vote")
    if accept:
        apply_proposal(db, team, proposal, user.id)
    else:
        _close(db, team, proposal, "rejected", user.id)
    db.commit()
    return proposal_dict(proposal)


@router.post("/v1/proposals/{proposal_id}/accept")
def accept_proposal(proposal_id: str, db: Db, user: CurrentUser) -> dict:
    return _decide(proposal_id, db, user, True)


@router.post("/v1/proposals/{proposal_id}/reject")
def reject_proposal(proposal_id: str, db: Db, user: CurrentUser) -> dict:
    return _decide(proposal_id, db, user, False)
