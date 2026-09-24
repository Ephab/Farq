from __future__ import annotations

"""Deterministic parse of a LinkedIn "Get a copy of your data" export ZIP."""

import csv
import io
import zipfile

from ..schemas import EvidenceIn
from . import SourceError
from .pdf_text import MAX_UPLOAD_BYTES

MAX_ROWS = 150


def _rows(archive: zipfile.ZipFile, name: str) -> list[dict]:
    match = next((info for info in archive.infolist() if info.filename.lower().endswith(name.lower())), None)
    if match is None or match.file_size > 5 * 1024 * 1024:
        return []
    text = archive.read(match).decode("utf-8-sig", errors="replace")
    # Some exports prefix CSVs with a "Notes:" block (quoted text, blank line) before the header.
    lines = text.splitlines()
    if lines and lines[0].strip().lower().startswith("notes"):
        while lines and lines[0].strip():
            lines.pop(0)
    while lines and not lines[0].strip():
        lines.pop(0)
    return list(csv.DictReader(io.StringIO("\n".join(lines))))[:MAX_ROWS]


def parse_linkedin_zip(data: bytes) -> list[EvidenceIn]:
    if len(data) > MAX_UPLOAD_BYTES * 3:
        raise SourceError("LinkedIn export is larger than 30 MB", status=413)
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise SourceError("That file is not a ZIP archive") from exc
    ref = "LinkedIn data export"
    items: list[EvidenceIn] = []
    for row in _rows(archive, "Positions.csv"):
        role, org = row.get("Title", "").strip(), row.get("Company Name", "").strip()
        if role or org:
            items.append(EvidenceIn(kind="experience", title=" at ".join(part for part in (role, org) if part), source_ref=ref, data={
                "org": org, "role": role, "start": row.get("Started On", ""), "end": row.get("Finished On", ""),
                "summary": row.get("Description", "")[:600],
            }))
    for row in _rows(archive, "Education.csv"):
        school = row.get("School Name", "").strip()
        if school:
            items.append(EvidenceIn(kind="education", title=school, source_ref=ref, data={
                "institution": school, "program": row.get("Degree Name", ""), "start": row.get("Start Date", ""),
                "end": row.get("End Date", ""), "notes": row.get("Notes", "")[:300],
            }))
    for row in _rows(archive, "Skills.csv"):
        name = row.get("Name", "").strip()
        if name:
            items.append(EvidenceIn(kind="skill", title=name, source_ref=ref, data={"context": "Listed on LinkedIn"}))
    for row in _rows(archive, "Certifications.csv"):
        name = row.get("Name", "").strip()
        if name:
            items.append(EvidenceIn(kind="certificate", title=name, source_ref=ref, data={
                "issuer": row.get("Authority", ""), "date": row.get("Started On", ""), "url": row.get("Url", ""),
            }))
    for row in _rows(archive, "Projects.csv"):
        name = row.get("Title", "").strip()
        if name:
            items.append(EvidenceIn(kind="project", title=name, source_ref=ref, data={
                "summary": row.get("Description", "")[:600], "url": row.get("Url", ""),
                "start": row.get("Started On", ""), "end": row.get("Finished On", ""),
            }))
    for row in _rows(archive, "Honors.csv"):
        name = row.get("Title", "").strip()
        if name:
            items.append(EvidenceIn(kind="activity", title=name, source_ref=ref, data={"summary": row.get("Description", "")[:300], "date": row.get("Issued On", "")}))
    if not items:
        raise SourceError("No positions, education, skills or projects were found in this export")
    return items
