from __future__ import annotations

import hashlib
import json
import ntpath
import os
import secrets
import time
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlparse
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import get_db
from .identity import CurrentUser, User
from .internal_auth import internal_token_ok
from .ownership import OwnedStudent, StreamUser, assert_owner
from .tool_grants import HermesToolGrant, ProjectsGrant
from .models import Project, ProjectEvaluation, ProjectRevision, ProjectSubmission, RoadmapVersion, StudentProfile, now
from .schemas import EvaluationComplete, EvaluationFailure, EvaluationProgress, ProjectBrief, ProjectEvaluationCreate, ProjectRevisionCreate, ProjectSubmissionCreate, RoadmapSnapshot


router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
UPLOAD_ROOT = Path(os.getenv("PROJECT_UPLOAD_ROOT", "/data/project-submissions" if Path("/data").exists() else Path(__file__).resolve().parents[2] / "data" / "project-submissions"))
MAX_PROJECT_UPLOAD = 100 * 1024 * 1024
EVALUATOR_LAST_SEEN = 0.0


def _active_roadmap(db: Session, student_id: str) -> RoadmapVersion:
    item = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    if item is None:
        raise HTTPException(404, "No active roadmap")
    return item


def _default_brief(node: dict) -> dict:
    topics = node.get("subtopics") or [node.get("title", "Project")]
    return ProjectBrief(
        title=node.get("title") or "Roadmap project",
        problem=node.get("description") or "Apply this learning sequence to a concrete problem.",
        objective=node.get("tagline") or "Build and explain a useful artifact.",
        deliverables=[f"A working artifact demonstrating {topic}" for topic in topics[:3]],
        milestones=["Define the scope and success criteria", "Build the first complete version", "Test, document, and present the result"],
        constraints=["Keep the scope achievable alongside university work"],
        tools=[], resources=node.get("resources") or [],
        rubric=[
            {"id": "requirements", "title": "Requirements", "description": "Meets the agreed project goals and deliverables.", "weight": 35},
            {"id": "correctness", "title": "Correctness", "description": "Works as claimed and handles important cases.", "weight": 30},
            {"id": "quality", "title": "Quality", "description": "Shows thoughtful craft, structure, and appropriate methods.", "weight": 20},
            {"id": "communication", "title": "Communication", "description": "Explains decisions, evidence, limitations, and usage clearly.", "weight": 15},
        ],
    ).model_dump()


def _sync_projects(db: Session, student_id: str) -> list[Project]:
    roadmap = _active_roadmap(db, student_id)
    snapshot = json.loads(roadmap.snapshot_json)
    profile = db.get(StudentProfile, student_id)
    existing = {item.roadmap_node_id: item for item in db.scalars(select(Project).where(Project.student_id == student_id)).all()}
    changed = False
    for node in snapshot.get("nodes", []):
        # Older persisted demo roadmaps predate the explicit project node type.
        # Promote their capstones in place so existing users receive the project
        # workspace without having to reset their roadmap history.
        legacy_project = str(node.get("id", "")).startswith("project-") or str(node.get("title", "")).lower().startswith("capstone:")
        if node.get("nodeType") != "project" and not legacy_project:
            continue
        if node.get("nodeType") != "project":
            node["nodeType"] = "project"
            changed = True
        project = existing.get(node["id"])
        if project is None:
            project = Project(student_id=student_id, roadmap_node_id=node["id"], title=node.get("title", "Project"), discipline=profile.discipline if profile else "other", project_type="generic")
            db.add(project)
            db.flush()
            revision = ProjectRevision(project_id=project.id, version=1, brief_json=json.dumps(_default_brief(node)), status="accepted", source="roadmap", accepted_at=now())
            db.add(revision)
            db.flush()
            project.current_revision_id = revision.id
            node["projectId"] = project.id
            existing[node["id"]] = project
            changed = True
        elif node.get("projectId") != project.id:
            node["projectId"] = project.id
            changed = True
    if changed:
        roadmap.snapshot_json = json.dumps(snapshot)
        db.commit()
    return list(existing.values())


def _project_dict(db: Session, item: Project) -> dict:
    revision = db.get(ProjectRevision, item.current_revision_id) if item.current_revision_id else None
    drafts = db.scalars(select(ProjectRevision).where(ProjectRevision.project_id == item.id, ProjectRevision.status == "draft").order_by(ProjectRevision.created_at.desc())).all()
    evaluations = db.scalars(select(ProjectEvaluation).where(ProjectEvaluation.project_id == item.id).order_by(ProjectEvaluation.created_at.desc())).all()
    return {
        "id": item.id, "student_id": item.student_id, "roadmap_node_id": item.roadmap_node_id,
        "title": item.title, "discipline": item.discipline, "project_type": item.project_type,
        "lifecycle": item.lifecycle, "latest_score": item.latest_score, "best_score": item.best_score,
        "brief": json.loads(revision.brief_json) if revision else None,
        "current_revision_id": item.current_revision_id,
        "draft_revisions": [{"id": draft.id, "version": draft.version, "source": draft.source, "brief": json.loads(draft.brief_json), "created_at": draft.created_at.isoformat()} for draft in drafts],
        "evaluations": [_evaluation_dict(evaluation) for evaluation in evaluations],
    }


def _evaluation_dict(item: ProjectEvaluation) -> dict:
    return {
        "id": item.id, "project_id": item.project_id, "submission_id": item.submission_id,
        "status": item.status, "stage": item.stage, "adapter": item.adapter,
        "score": item.score, "coverage": item.coverage,
        "report": json.loads(item.report_json) if item.report_json else None,
        "error": item.error, "created_at": item.created_at.isoformat(),
        "finished_at": item.finished_at.isoformat() if item.finished_at else None,
    }


def _require_project(db: Session, project_id: str) -> Project:
    item = db.get(Project, project_id)
    if item is None:
        raise HTTPException(404, "Project not found")
    return item


def _owned_project(db: Session, project_id: str, user: User) -> Project:
    project = _require_project(db, project_id)
    assert_owner(user, project.student_id)
    return project


@router.get("/api/students/{student_id}/projects")
def list_projects(student_id: str, _owner: OwnedStudent, db: Db) -> list[dict]:
    return [_project_dict(db, item) for item in _sync_projects(db, student_id)]


@router.get("/api/projects/{project_id}")
def get_project(project_id: str, db: Db, user: CurrentUser) -> dict:
    return _project_dict(db, _owned_project(db, project_id, user))


@router.post("/api/projects/{project_id}/refinements")
def create_revision(project_id: str, body: ProjectRevisionCreate, db: Db, user: CurrentUser) -> dict:
    return _create_revision(db, _owned_project(db, project_id, user), body)


def _create_revision(db: Session, project: Project, body: ProjectRevisionCreate) -> dict:
    version = (db.scalar(select(func.max(ProjectRevision.version)).where(ProjectRevision.project_id == project.id)) or 0) + 1
    revision = ProjectRevision(project_id=project.id, version=version, brief_json=body.brief.model_dump_json(), status="draft", source=body.source)
    db.add(revision); db.commit()
    return {"id": revision.id, "version": revision.version, "status": revision.status, "brief": body.brief.model_dump()}


@router.post("/api/projects/{project_id}/refinements/{revision_id}/accept")
def accept_revision(project_id: str, revision_id: str, db: Db, user: CurrentUser) -> dict:
    project = _owned_project(db, project_id, user)
    revision = db.get(ProjectRevision, revision_id)
    if revision is None or revision.project_id != project.id:
        raise HTTPException(404, "Project revision not found")
    if revision.status == "accepted":
        return _project_dict(db, project)
    for old in db.scalars(select(ProjectRevision).where(ProjectRevision.project_id == project.id, ProjectRevision.status == "accepted")).all():
        old.status = "superseded"
    brief = ProjectBrief.model_validate_json(revision.brief_json)
    revision.status = "accepted"; revision.accepted_at = now()
    project.current_revision_id = revision.id; project.title = brief.title
    roadmap = _active_roadmap(db, project.student_id)
    snapshot = RoadmapSnapshot.model_validate_json(roadmap.snapshot_json)
    node = next((node for node in snapshot.nodes if node.id == project.roadmap_node_id), None)
    if node is None:
        raise HTTPException(409, "The linked roadmap node no longer exists")
    node.title = brief.title; node.description = brief.problem; node.tagline = brief.objective[:160]; node.projectId = project.id
    roadmap.active = False
    next_version = RoadmapVersion(student_id=project.student_id, version=roadmap.version + 1, snapshot_json=snapshot.model_dump_json(), reason=f"Refined project: {brief.title}", active=True)
    db.add(next_version); db.commit()
    return _project_dict(db, project)


@router.post("/api/projects/{project_id}/submissions")
def create_submission(project_id: str, body: ProjectSubmissionCreate, db: Db, user: CurrentUser) -> dict:
    project = _owned_project(db, project_id, user)
    if body.source_type == "github":
        parsed = urlparse(body.source_ref)
        if parsed.scheme != "https" or parsed.hostname not in {"github.com", "www.github.com"} or parsed.username or parsed.password:
            raise HTTPException(422, "Use a public HTTPS GitHub repository URL")
    if body.source_type == "local_directory" and not (os.path.isabs(body.source_ref) or ntpath.isabs(body.source_ref)):
        raise HTTPException(422, "Local project paths must be absolute")
    digest = body.snapshot_hash or hashlib.sha256(f"{body.source_type}:{body.source_ref}".encode()).hexdigest()
    item = ProjectSubmission(project_id=project.id, source_type=body.source_type, source_ref=body.source_ref, snapshot_hash=digest, manifest_json=json.dumps(body.manifest))
    db.add(item); db.commit()
    return {"id": item.id, "project_id": item.project_id, "source_type": item.source_type, "source_ref": item.source_ref, "snapshot_hash": item.snapshot_hash}


@router.post("/api/projects/{project_id}/submissions/upload")
async def upload_submission(project_id: str, db: Db, user: CurrentUser, file: UploadFile = File(...)) -> dict:
    project = _owned_project(db, project_id, user)
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(422, "Project uploads must be ZIP archives")
    content = await file.read(MAX_PROJECT_UPLOAD + 1)
    if len(content) > MAX_PROJECT_UPLOAD:
        raise HTTPException(413, "Project archive exceeds 100 MB")
    if not content.startswith(b"PK"):
        raise HTTPException(422, "The uploaded file is not a ZIP archive")
    digest = hashlib.sha256(content).hexdigest()
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    path = UPLOAD_ROOT / f"{project.id}-{digest}.zip"
    if not path.exists():
        path.write_bytes(content)
    item = ProjectSubmission(project_id=project.id, source_type="zip", source_ref=str(path), snapshot_hash=digest, manifest_json=json.dumps({"filename": Path(file.filename or "project.zip").name, "bytes": len(content)}))
    db.add(item); db.commit()
    return {"id": item.id, "project_id": item.project_id, "source_type": item.source_type, "filename": Path(file.filename or "project.zip").name, "snapshot_hash": item.snapshot_hash}


@router.post("/api/projects/{project_id}/evaluations")
def create_evaluation(project_id: str, body: ProjectEvaluationCreate, db: Db, user: CurrentUser) -> dict:
    project = _owned_project(db, project_id, user)
    submission = db.get(ProjectSubmission, body.submission_id)
    if submission is None or submission.project_id != project.id:
        raise HTTPException(404, "Submission not found for this project")
    item = ProjectEvaluation(project_id=project.id, submission_id=submission.id)
    project.lifecycle = "evaluating"
    db.add(item); db.commit()
    return _evaluation_dict(item)


@router.get("/api/evaluations/{evaluation_id}")
def get_evaluation(evaluation_id: str, db: Db, user: CurrentUser) -> dict:
    item = db.get(ProjectEvaluation, evaluation_id)
    if item is None:
        raise HTTPException(404, "Evaluation not found")
    _owned_project(db, item.project_id, user)
    return _evaluation_dict(item)


@router.get("/api/evaluations/{evaluation_id}/events")
def evaluation_events(evaluation_id: str, db: Db, user: StreamUser):
    evaluation = db.get(ProjectEvaluation, evaluation_id)
    if evaluation is None:
        raise HTTPException(404, "Evaluation not found")
    _owned_project(db, evaluation.project_id, user)

    def stream():
        from .database import SessionLocal
        last = None
        while True:
            session = SessionLocal()
            try:
                item = session.get(ProjectEvaluation, evaluation_id)
                if item is None:
                    yield "event: error\ndata: {\"error\":\"Evaluation disappeared\"}\n\n"; return
                payload = _evaluation_dict(item)
            finally:
                session.close()
            encoded = json.dumps(payload)
            if encoded != last:
                yield f"event: progress\ndata: {encoded}\n\n"; last = encoded
            if payload["status"] in {"completed", "failed"}:
                yield f"event: done\ndata: {encoded}\n\n"; return
            time.sleep(1)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _require_worker(x_waypoint_internal_token: Annotated[str | None, Header()] = None) -> None:
    if not internal_token_ok(x_waypoint_internal_token):
        raise HTTPException(401, "Invalid evaluator token")


@router.post("/internal/evaluator/jobs/claim", dependencies=[Depends(_require_worker)])
def claim_evaluation(db: Db) -> dict:
    global EVALUATOR_LAST_SEEN
    EVALUATOR_LAST_SEEN = time.monotonic()
    item = db.scalar(select(ProjectEvaluation).where(ProjectEvaluation.status == "queued").order_by(ProjectEvaluation.created_at))
    if item is None:
        return {"job": None}
    token = secrets.token_hex(24)
    item.status = "running"; item.stage = "Preparing isolated evaluation"; item.started_at = now(); item.lease_token = token; item.lease_expires_at = now() + timedelta(minutes=10)
    submission = db.get(ProjectSubmission, item.submission_id)
    project = db.get(Project, item.project_id)
    revision = db.get(ProjectRevision, project.current_revision_id) if project and project.current_revision_id else None
    db.commit()
    return {"job": {"id": item.id, "lease_token": token, "project": _project_dict(db, project), "submission": {"id": submission.id, "source_type": submission.source_type, "source_ref": submission.source_ref, "manifest": json.loads(submission.manifest_json)}, "brief": json.loads(revision.brief_json) if revision else None}}


@router.post("/internal/evaluator/jobs/{evaluation_id}/progress", dependencies=[Depends(_require_worker)])
def evaluation_progress(evaluation_id: str, body: EvaluationProgress, db: Db) -> dict:
    item = db.get(ProjectEvaluation, evaluation_id)
    if item is None or not secrets.compare_digest(item.lease_token or "", body.lease_token):
        raise HTTPException(409, "Evaluation lease is invalid")
    item.stage = body.stage; item.lease_expires_at = now() + timedelta(minutes=10); db.commit()
    return {"status": item.status, "stage": item.stage}


@router.post("/internal/evaluator/jobs/{evaluation_id}/complete", dependencies=[Depends(_require_worker)])
def complete_evaluation(evaluation_id: str, body: EvaluationComplete, db: Db) -> dict:
    item = db.get(ProjectEvaluation, evaluation_id)
    if item is None or not secrets.compare_digest(item.lease_token or "", body.lease_token):
        raise HTTPException(409, "Evaluation lease is invalid")
    project = _require_project(db, item.project_id)
    item.status = "completed"; item.stage = "Evaluation complete"; item.adapter = body.adapter; item.score = body.score; item.coverage = body.coverage; item.report_json = body.model_dump_json(exclude={"lease_token"}); item.finished_at = now(); item.lease_token = None
    project.lifecycle = "evaluated"; project.latest_score = body.score; project.best_score = max(project.best_score or 0, body.score)
    roadmap = _active_roadmap(db, project.student_id)
    snapshot = RoadmapSnapshot.model_validate_json(roadmap.snapshot_json)
    node = next((node for node in snapshot.nodes if node.id == project.roadmap_node_id), None)
    if node is not None:
        node.status = "done"; node.projectId = project.id; roadmap.snapshot_json = snapshot.model_dump_json()
    db.commit()
    return _evaluation_dict(item)


@router.post("/internal/evaluator/jobs/{evaluation_id}/fail", dependencies=[Depends(_require_worker)])
def fail_evaluation(evaluation_id: str, body: EvaluationFailure, db: Db) -> dict:
    item = db.get(ProjectEvaluation, evaluation_id)
    if item is None or not secrets.compare_digest(item.lease_token or "", body.lease_token):
        raise HTTPException(409, "Evaluation lease is invalid")
    project = _require_project(db, item.project_id)
    item.status = "failed"; item.stage = "Evaluation failed"; item.error = body.error; item.finished_at = now(); item.lease_token = None
    project.lifecycle = "in-progress"
    db.commit()
    return _evaluation_dict(item)


@router.get("/internal/evaluator/submissions/{submission_id}/archive", dependencies=[Depends(_require_worker)])
def download_submission(submission_id: str, db: Db):
    item = db.get(ProjectSubmission, submission_id)
    if item is None or item.source_type != "zip":
        raise HTTPException(404, "ZIP submission not found")
    path = Path(item.source_ref)
    if not path.is_file() or path.parent.resolve() != UPLOAD_ROOT.resolve():
        raise HTTPException(404, "ZIP artifact is unavailable")
    return FileResponse(path, media_type="application/zip", filename="project.zip")


@router.get("/api/evaluator/status")
def evaluator_status(db: Db) -> dict:
    latest = db.scalar(select(ProjectEvaluation).where(ProjectEvaluation.status == "running").order_by(ProjectEvaluation.started_at.desc()))
    online = time.monotonic() - EVALUATOR_LAST_SEEN < 10
    return {"status": "offline" if not online else "busy" if latest else "ready", "active_job": latest.id if latest else None}


@router.post("/internal/evaluator/heartbeat", dependencies=[Depends(_require_worker)])
def evaluator_heartbeat() -> dict:
    global EVALUATOR_LAST_SEEN
    EVALUATOR_LAST_SEEN = time.monotonic()
    return {"status": "ready"}


def _granted_project(db: Session, project_id: str, grant: HermesToolGrant) -> Project:
    project = _require_project(db, project_id)
    if project.student_id != grant.student_id:
        raise HTTPException(404, "Project not found")
    return project


@router.get("/internal/hermes/projects/{project_id}")
def internal_project(project_id: str, db: Db, grant: ProjectsGrant) -> dict:
    return _project_dict(db, _granted_project(db, project_id, grant))


@router.post("/internal/hermes/projects/{project_id}/refinements")
def internal_project_revision(project_id: str, body: ProjectRevisionCreate, db: Db, grant: ProjectsGrant) -> dict:
    return _create_revision(db, _granted_project(db, project_id, grant), body)
