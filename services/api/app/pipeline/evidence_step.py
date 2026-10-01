"""Step 2: evidence ingest. One adapter per source kind.

Every adapter returns normalized evidence stored as `suggested`.
Nothing here creates a StudentFact — only the student's explicit
review (review_step) promotes items.
"""

from __future__ import annotations

import json
import os
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import llm_direct
from ..hermes import HermesJsonError, is_nvapi_key, run_json_prompt
from ..models import DataSource, EvidenceItem
from ..sources import SourceError, store_evidence
from ..sources import jobs
from ..sources.extract import extract_items
from ..sources.linkedin_zip import parse_linkedin_zip
from ..sources.pdf_text import extract_pdf_text
from ..sources.web import fetch_github, fetch_orcid, fetch_page_text
from ..tool_grants import EVIDENCE, issue_grant, revoke_grant

FOLDER_INSTRUCTIONS = """
You are Hermes indexing one folder on the student's own computer for Waypoint onboarding.
Call waypoint_index_folder exactly once with the user_id, grant, source_id, path and purpose given below.
It scans the folder and submits the evidence itself. Do not call any other tool, do not read
files, and never try to open .env files, keys, credentials or secrets.
Then reply with one short sentence stating how many items were submitted for review.
""".strip()


def _progress(source: DataSource):
    return lambda stage, **detail: jobs.set_stage(source.id, stage, **detail)


def prepare_upload(source: DataSource, data: bytes, filename: str, hermes: dict):
    """The cheap, instant part of reading an upload: type/size checks, PDF text, ZIP parsing.

    Raises SourceError right away for a wrong or scanned file. Returns the slow part (the model
    call and the save) as a callable so the API can run it in the background.
    """
    ref = filename[:200] or source.kind
    if source.kind == "linkedin_zip":
        parsed = parse_linkedin_zip(data)
        return lambda db, src: _save(db, src, parsed)
    text = extract_pdf_text(data)
    return lambda db, src: _save(db, src, extract_items(src.kind, text, ref, progress=_progress(src), **hermes))


def _save(db: Session, source: DataSource, items) -> int:
    jobs.set_stage(source.id, "saving")
    return store_evidence(db, source.student_id, source.id, items)


def sync_upload(db: Session, source: DataSource, data: bytes, filename: str, hermes: dict) -> int:
    return prepare_upload(source, data, filename, hermes)(db, source)


def sync_remote(db: Session, source: DataSource, hermes: dict) -> int:
    config = json.loads(source.config_json)
    jobs.set_stage(source.id, "reading")
    if source.kind == "github":
        items = fetch_github(config["username"])
    elif source.kind == "orcid":
        items = fetch_orcid(config["orcid"])
    elif source.kind == "portfolio_url":
        text = fetch_page_text(config["url"])
        items = extract_items("portfolio_url", text, config["url"], progress=_progress(source), **hermes)
    elif source.kind == "folder":
        jobs.set_stage(source.id, "extracting")
        return run_folder_ingest(db, source, hermes)
    else:
        raise SourceError("Upload a file for this source", status=422)
    return _save(db, source, items)


def run_folder_ingest(db: Session, source: DataSource, hermes: dict) -> int:
    """Ask Hermes (on the student's machine) to scan a folder and submit evidence.

    The grant lets this one run submit evidence for this one source and nothing else.
    """
    config = json.loads(source.config_json)
    before = _evidence_count(db, source.id)
    grant = issue_grant(db, source.student_id, (EVIDENCE,), source_id=source.id, ttl_seconds=600)
    db.commit()
    prompt = (
        f"Waypoint user_id={source.student_id}; grant={grant}; source_id={source.id}.\n"
        f"Scan this folder: path={json.dumps(config['path'])} purpose={config.get('purpose') or 'projects'}"
    )
    try:
        output = run_json_prompt("ingest", prompt, FOLDER_INSTRUCTIONS, timeout_seconds=150, **_folder_args(hermes))
    except HermesJsonError as exc:
        raise SourceError(str(exc), status=exc.status) from exc
    finally:
        revoke_grant(db, grant)
        db.commit()
    db.expire_all()
    added = _evidence_count(db, source.id) - before
    if added <= 0 and not _reported_submissions(output):
        raise SourceError("Hermes finished but submitted no evidence for this folder", status=502)
    return max(added, 0)


def _reported_submissions(output: str) -> bool:
    """Re-indexing a folder whose items already exist adds no rows but still succeeded."""
    return bool(re.search(r"\b([1-9]\d*)\s+(items?|projects?|courses?)\b", output or "", re.IGNORECASE))


def _evidence_count(db: Session, source_id: str) -> int:
    return len(db.scalars(select(EvidenceItem.id).where(EvidenceItem.source_id == source_id)).all())


def _hermes_args(hermes: dict) -> dict:
    return {"provider": hermes.get("provider"), "model": hermes.get("model"), "hermes_api_key": hermes.get("key")}


# Indexing a folder is one mechanical tool call, so it starts on a fast tool-capable model rather
# than whatever large model the student chose for chat (a 550B model measured 20+ s per turn and
# was often overloaded). A student who sets nothing server-side keeps their own selection.
FOLDER_FAST_MODEL = "gemini-3.5-flash-lite"


def _folder_args(hermes: dict) -> dict:
    args = _hermes_args(hermes)
    if llm_direct.is_configured() and os.getenv("GEMINI_API_KEY", "").strip() and not is_nvapi_key(args.get("hermes_api_key")):
        args["provider"], args["model"] = "gemini", FOLDER_FAST_MODEL
    return args
