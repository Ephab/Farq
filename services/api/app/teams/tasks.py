from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import AfterValidator, BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..identity import CurrentUser
from ..models import now
from .chat import post_message
from .common import Db, iso, loads, require, require_team, utc
from .events import emit
from .models import Milestone, Task, Team, TeamMember
from .policy import authorize

router = APIRouter()
TASK_STATUSES = ("todo", "doing", "review", "done")
UtcDatetime = Annotated[datetime | None, AfterValidator(utc)]


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    assignee_id: str | None = None
    estimate_points: int = Field(default=1, ge=1, le=8)
    due: UtcDatetime = None
    depends_on: list[str] = Field(default_factory=list, max_length=20)
    milestone_id: str | None = None
    rubric_refs: list[str] = Field(default_factory=list, max_length=12)
    rationale: str = Field(default="", max_length=1000)


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    assignee_id: str | None = None
    estimate_points: int | None = Field(default=None, ge=1, le=8)
    due: UtcDatetime = None
    depends_on: list[str] | None = Field(default=None, max_length=20)
    milestone_id: str | None = None
    rubric_refs: list[str] | None = Field(default=None, max_length=12)


class TaskMove(BaseModel):
    status: Literal["todo", "doing", "review", "done"]
    position: float | None = None


class MilestoneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    due: UtcDatetime = None
    deliverable_key: str | None = Field(default=None, max_length=24)


class MilestonePatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    due: UtcDatetime = None


def task_dict(task: Task) -> dict:
    return {
        "id": task.id, "team_id": task.team_id, "title": task.title, "description": task.description,
        "status": task.status, "assignee_id": task.assignee_id, "estimate_points": task.estimate_points,
        "due": iso(task.due), "depends_on": loads(task.depends_on_json, []), "milestone_id": task.milestone_id,
        "rubric_refs": loads(task.rubric_refs_json, []), "rationale": task.rationale, "created_by": task.created_by,
        "position": task.position, "created_at": iso(task.created_at), "updated_at": iso(task.updated_at),
    }


def milestone_dict(milestone: Milestone) -> dict:
    return {
        "id": milestone.id, "team_id": milestone.team_id, "title": milestone.title, "due": iso(milestone.due),
        "deliverable_key": milestone.deliverable_key, "completed_at": iso(milestone.completed_at),
    }


def assert_acyclic(graph: dict[str, list[str]]) -> None:
    state: dict[str, int] = {}

    def visit(node: str) -> None:
        if state.get(node) == 1:
            raise ValueError("Task dependencies would form a cycle")
        if state.get(node) == 2:
            return
        state[node] = 1
        for dependency in graph.get(node, []):
            visit(dependency)
        state[node] = 2

    for node in graph:
        visit(node)


def _team_tasks(db: Session, team_id: str) -> list[Task]:
    return db.scalars(select(Task).where(Task.team_id == team_id)).all()


def _validate(db: Session, team: Team, *, assignee_id: str | None, milestone_id: str | None, depends_on: list[str], task_id: str | None = None) -> None:
    if assignee_id is not None and not db.scalar(select(TeamMember.id).where(TeamMember.team_id == team.id, TeamMember.user_id == assignee_id)):
        raise HTTPException(422, "The assignee must be a member of this team")
    if milestone_id is not None:
        milestone = db.get(Milestone, milestone_id)
        if milestone is None or milestone.team_id != team.id:
            raise HTTPException(422, "Unknown milestone")
    tasks = _team_tasks(db, team.id)
    if (task_id is not None and task_id in depends_on) or set(depends_on) - {task.id for task in tasks}:
        raise HTTPException(422, "Dependencies must be other tasks in this team")
    graph = {task.id: loads(task.depends_on_json, []) for task in tasks}
    if task_id is not None:
        graph[task_id] = list(depends_on)
    try:
        assert_acyclic(graph)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def _next_position(db: Session, team_id: str, status: str) -> float:
    current = db.scalar(select(func.max(Task.position)).where(Task.team_id == team_id, Task.status == status))
    return (current or 0) + 1


def _sync_milestone(db: Session, team_id: str, milestone_id: str | None, actor: str) -> None:
    if not milestone_id:
        return
    milestone = db.get(Milestone, milestone_id)
    statuses = db.scalars(select(Task.status).where(Task.milestone_id == milestone_id)).all()
    complete = bool(statuses) and all(status == "done" for status in statuses)
    if complete and milestone.completed_at is None:
        milestone.completed_at = now()
        emit(db, team_id, "milestone.completed", actor, milestone_dict(milestone))
        post_message(db, team_id, None, f"Milestone complete: {milestone.title}", kind="system", metadata={"milestone_id": milestone.id})
    elif not complete and milestone.completed_at is not None:
        milestone.completed_at = None
        emit(db, team_id, "milestone.updated", actor, milestone_dict(milestone))


@router.post("/api/teams/{team_id}/tasks", status_code=201)
def create_task(team_id: str, body: TaskCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Give the task a title")
    _validate(db, team, assignee_id=body.assignee_id, milestone_id=body.milestone_id, depends_on=body.depends_on)
    task = Task(
        team_id=team.id, title=title, description=body.description, assignee_id=body.assignee_id,
        estimate_points=body.estimate_points, due=body.due, depends_on_json=json.dumps(body.depends_on),
        milestone_id=body.milestone_id, rubric_refs_json=json.dumps(body.rubric_refs), rationale=body.rationale,
        created_by="user", position=_next_position(db, team.id, "todo"),
    )
    db.add(task)
    db.flush()
    emit(db, team.id, "task.created", user.id, task_dict(task))
    _sync_milestone(db, team.id, task.milestone_id, user.id)
    db.commit()
    return task_dict(task)


@router.patch("/api/tasks/{task_id}")
def update_task(task_id: str, body: TaskPatch, db: Db, user: CurrentUser) -> dict:
    task = require(db, Task, task_id, "Task")
    team = require_team(db, task.team_id)
    authorize(db, user, team, "write")
    fields = body.model_fields_set
    if not fields:
        raise HTTPException(422, "Nothing to update")
    assignee = body.assignee_id if "assignee_id" in fields else task.assignee_id
    milestone = body.milestone_id if "milestone_id" in fields else task.milestone_id
    depends_on = body.depends_on if body.depends_on is not None else loads(task.depends_on_json, [])
    _validate(db, team, assignee_id=assignee, milestone_id=milestone, depends_on=depends_on, task_id=task.id)
    previous_milestone = task.milestone_id
    if body.title is not None:
        task.title = body.title.strip() or task.title
    if body.description is not None:
        task.description = body.description
    if body.estimate_points is not None:
        task.estimate_points = body.estimate_points
    if body.rubric_refs is not None:
        task.rubric_refs_json = json.dumps(body.rubric_refs)
    if "due" in fields:
        task.due = body.due
    task.assignee_id = assignee
    task.milestone_id = milestone
    task.depends_on_json = json.dumps(depends_on)
    task.updated_at = now()
    db.flush()
    emit(db, team.id, "task.updated", user.id, task_dict(task))
    if previous_milestone != milestone:
        _sync_milestone(db, team.id, previous_milestone, user.id)
        _sync_milestone(db, team.id, milestone, user.id)
    db.commit()
    return task_dict(task)


@router.post("/api/tasks/{task_id}/move")
def move_task(task_id: str, body: TaskMove, db: Db, user: CurrentUser) -> dict:
    task = require(db, Task, task_id, "Task")
    team = require_team(db, task.team_id)
    authorize(db, user, team, "write")
    if body.position is not None and not math.isfinite(body.position):
        # Checked here, not by Pydantic: its 422 body would echo inf/NaN, which is not JSON,
        # and a stored Infinity would break every client's JSON.parse of the event.
        raise HTTPException(422, "Position must be a finite number")
    previous = task.status
    position = body.position if body.position is not None else _next_position(db, team.id, body.status)
    task.status = body.status
    task.position = position
    task.updated_at = now()
    db.flush()
    emit(db, team.id, "task.moved", user.id, {"id": task.id, "status": task.status, "position": task.position, "from": previous})
    _sync_milestone(db, team.id, task.milestone_id, user.id)
    db.commit()
    return task_dict(task)


@router.delete("/api/tasks/{task_id}")
def delete_task(task_id: str, db: Db, user: CurrentUser) -> dict:
    task = require(db, Task, task_id, "Task")
    team = require_team(db, task.team_id)
    authorize(db, user, team, "write")
    detached = []
    for other in _team_tasks(db, team.id):
        dependencies = loads(other.depends_on_json, [])
        if task.id in dependencies:
            other.depends_on_json = json.dumps([item for item in dependencies if item != task.id])
            detached.append(other.id)
    milestone_id = task.milestone_id
    db.delete(task)
    db.flush()
    emit(db, team.id, "task.deleted", user.id, {"id": task_id, "detached_from": detached})
    _sync_milestone(db, team.id, milestone_id, user.id)
    db.commit()
    return {"id": task_id, "deleted": True}


@router.post("/api/teams/{team_id}/milestones", status_code=201)
def create_milestone(team_id: str, body: MilestoneCreate, db: Db, user: CurrentUser) -> dict:
    team = require_team(db, team_id)
    authorize(db, user, team, "write")
    milestone = Milestone(team_id=team.id, title=body.title.strip(), due=body.due, deliverable_key=body.deliverable_key)
    db.add(milestone)
    db.flush()
    emit(db, team.id, "milestone.created", user.id, milestone_dict(milestone))
    db.commit()
    return milestone_dict(milestone)


@router.patch("/api/milestones/{milestone_id}")
def update_milestone(milestone_id: str, body: MilestonePatch, db: Db, user: CurrentUser) -> dict:
    milestone = require(db, Milestone, milestone_id, "Milestone")
    authorize(db, user, require_team(db, milestone.team_id), "write")
    if body.title is not None:
        milestone.title = body.title.strip() or milestone.title
    if "due" in body.model_fields_set:
        milestone.due = body.due
    emit(db, milestone.team_id, "milestone.updated", user.id, milestone_dict(milestone))
    db.commit()
    return milestone_dict(milestone)
