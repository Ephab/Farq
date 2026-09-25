from __future__ import annotations

"""Step 2: evidence ingest. One adapter per source kind.

Every adapter returns normalized evidence stored as `suggested`.
Nothing here creates a StudentFact — only the student's explicit
review (review_step) promotes items.
"""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..hermes import HermesJsonError, run_json_prompt
from ..models import DataSource, EvidenceItem
from ..sources import SourceError, store_evidence
from ..sources.extract import extract_items
from ..sources.linkedin_zip import parse_linkedin_zip
from ..sources.pdf_text import extract_pdf_text
from ..sources.web import fetch_github, fetch_orcid, fetch_page_text

FOLDER_INSTRUCTIONS = """
You are Hermes indexing one folder on the student's own computer for Farq onboarding.
Call farq_index_folder exactly once with the user_id, source_id, path and purpose given below.
It scans the folder and submits the evidence itself. Do not call any other tool, do not read
files, and never try to open .env files, keys, credentials or secrets.
Then reply with one short sentence stating how many items were submitted for review.
""".strip()


def sync_upload(db: Session, source: DataSource, data: bytes, filename: str, hermes: dict) -> int:
    ref = filename[:200] or source.kind
    if source.kind == "linkedin_zip":
        items = parse_linkedin_zip(data)
    else:
        items = extract_items(source.kind, extract_pdf_text(data), ref, **hermes)
    return store_evidence(db, source.student_id, source.id, items)


def sync_remote(db: Session, source: DataSource, hermes: dict) -> int:
    config = json.loads(source.config_json)
    if source.kind == "github":
        items = fetch_github(config["username"])
    elif source.kind == "orcid":
        items = fetch_orcid(config["orcid"])
    elif source.kind == "portfolio_url":
        items = extract_items("portfolio_url", fetch_page_text(config["url"]), config["url"], **hermes)
    elif source.kind == "folder":
        return run_folder_ingest(db, source, hermes)
    else:
        raise SourceError("Upload a file for this source", status=422)
    return store_evidence(db, source.student_id, source.id, items)


def run_folder_ingest(db: Session, source: DataSource, hermes: dict) -> int:
    """Ask Hermes (on the student's machine) to scan a folder and submit evidence."""
    config = json.loads(source.config_json)
    before = _evidence_count(db, source.id)
    prompt = (
        f"Farq user_id={source.student_id}; source_id={source.id}.\n"
        f"Scan this folder: path={json.dumps(config['path'])} purpose={config.get('purpose') or 'projects'}"
    )
    try:
        run_json_prompt("ingest", prompt, FOLDER_INSTRUCTIONS, timeout_seconds=300, **_hermes_args(hermes))
    except HermesJsonError as exc:
        raise SourceError(str(exc), status=exc.status) from exc
    db.expire_all()
    added = _evidence_count(db, source.id) - before
    if added <= 0:
        raise SourceError("Hermes finished but submitted no evidence for this folder", status=502)
    return added


def _evidence_count(db: Session, source_id: str) -> int:
    return len(db.scalars(select(EvidenceItem.id).where(EvidenceItem.source_id == source_id)).all())


def _hermes_args(hermes: dict) -> dict:
    return {"provider": hermes.get("provider"), "model": hermes.get("model"), "hermes_api_key": hermes.get("key")}
