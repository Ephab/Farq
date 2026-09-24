from __future__ import annotations

"""Evidence sources: turn a student's existing records into reviewable evidence.

Every adapter returns normalized `EvidenceIn` items. Nothing here creates a
StudentFact: evidence is stored as `suggested` and only the student's explicit
confirmation (POST /evidence/decide) promotes it. All fetched or uploaded
content is untrusted data.
"""

import json
import re
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import EvidenceItem
from ..schemas import EvidenceIn


class SourceError(RuntimeError):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


GITHUB_USER = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
ORCID_ID = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


def normalize_value(kind: str, value: str) -> dict:
    """Validate the one user-entered value per source and return its config."""
    value = value.strip()
    if kind == "github":
        match = re.search(r"github\.com/([^/?#]+)", value)
        username = (match.group(1) if match else value).lstrip("@")
        if not GITHUB_USER.match(username):
            raise SourceError("Enter a GitHub username or profile URL")
        return {"username": username}
    if kind == "orcid":
        match = re.search(r"(\d{4}-\d{4}-\d{4}-\d{3}[\dX])", value.upper())
        if not match or not ORCID_ID.match(match.group(1)):
            raise SourceError("Enter an ORCID iD like 0000-0002-1825-0097")
        return {"orcid": match.group(1)}
    if kind == "portfolio_url":
        if not re.match(r"^https://[^\s/]+\.[^\s/]+", value):
            raise SourceError("Enter a public https:// URL")
        return {"url": value}
    if kind == "folder":
        if len(value) < 2:
            raise SourceError("Enter the full path of a folder on this computer")
        return {"path": value}
    return {}


def fingerprint_for(item: EvidenceIn) -> str:
    if item.fingerprint:
        base = item.fingerprint
    elif item.kind == "course" and item.data.get("code"):
        base = f"course:{item.data['code']}"
    elif item.kind == "project" and item.data.get("url"):
        base = f"project:{item.data['url']}"
    else:
        base = f"{item.kind}:{item.title}"
    text = unicodedata.normalize("NFKC", base).lower()
    text = re.sub(r"\.git$|/+$", "", text)
    return re.sub(r"[\s_-]+", "", text)[:300]


def store_evidence(db: Session, student_id: str, source_id: str, items: list[EvidenceIn]) -> int:
    """Insert new suggested evidence, merging duplicates across sources.

    A duplicate of an existing item gains extra provenance instead of a new
    row, so a GitHub repo and the same local folder show up once.
    """
    existing = {item.fingerprint: item for item in db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student_id)).all()}
    added = 0
    for item in items:
        fingerprint = fingerprint_for(item)
        current = existing.get(fingerprint)
        if current is not None:
            data = json.loads(current.data_json)
            for key, value in item.data.items():
                data.setdefault(key, value)
            refs = set(filter(None, data.get("also_from", []) + [item.source_ref]))
            if item.source_ref and item.source_ref != current.source_ref:
                data["also_from"] = sorted(refs)
            current.data_json = json.dumps(data)
            continue
        row = EvidenceItem(
            student_id=student_id,
            source_id=source_id,
            kind=item.kind,
            title=item.title.strip()[:240],
            data_json=json.dumps(item.data),
            source_ref=item.source_ref[:500],
            fingerprint=fingerprint,
        )
        db.add(row)
        existing[fingerprint] = row
        added += 1
    return added
