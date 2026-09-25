from __future__ import annotations

"""Step 5: synthesis. Deterministic brief + readiness gate.

The brief is the only thing the roadmap generator sees: confirmed
evidence, stated facts, and basics. Suggested-but-unreviewed items
never enter it.
"""

import json

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import ChatMessage, ChatThread, EvidenceItem, Student, StudentFact, StudentProfile


def build_profile_brief(db: Session, student_id: str) -> dict:
    """Deterministic, compact summary of everything Farq knows and the student confirmed."""
    student = db.get(Student, student_id)
    profile = db.get(StudentProfile, student_id) or StudentProfile(student_id=student_id)
    evidence = db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student_id, EvidenceItem.status == "confirmed")).all()
    facts = db.scalars(select(StudentFact).where(StudentFact.student_id == student_id, StudentFact.active.is_(True))).all()
    grouped: dict[str, list[dict]] = {}
    for item in evidence:
        data = json.loads(item.data_json)
        data.pop("readme_excerpt", None)
        grouped.setdefault(item.kind, []).append({"evidence_id": item.id, "title": item.title, **{k: v for k, v in data.items() if v not in ("", [], None)}})
    return {
        "name": student.display_name if student else "",
        "institution": profile.institution,
        "program": profile.program,
        "discipline": profile.discipline,
        "year": profile.year_label,
        "graduation_target": profile.grad_target,
        "confirmed_evidence": {kind: rows[:40] for kind, rows in grouped.items()},
        "stated_facts": [
            {"category": fact.category, "key": fact.key, "value": json.loads(fact.value_json)}
            for fact in facts if fact.source_kind != "confirmed_evidence"
        ],
    }


def readiness(db: Session, student_id: str) -> dict:
    """Readiness gate: is there enough background to generate a roadmap?"""
    profile = db.get(StudentProfile, student_id)
    brief = build_profile_brief(db, student_id)
    confirmed = sum(len(rows) for rows in brief["confirmed_evidence"].values())
    stated = len(brief["stated_facts"])
    suggested = db.scalar(select(func.count()).select_from(EvidenceItem).where(EvidenceItem.student_id == student_id, EvidenceItem.status == "suggested")) or 0
    thread_ids = db.scalars(select(ChatThread.id).where(ChatThread.student_id == student_id)).all()
    chat_turns = 0
    if thread_ids:
        chat_turns = db.scalar(select(func.count()).select_from(ChatMessage).where(ChatMessage.thread_id.in_(thread_ids), ChatMessage.role == "user")) or 0
    blockers: list[str] = []
    if profile is None or not ((profile.program or "").strip() or (profile.institution or "").strip()):
        blockers.append("Add your basics (institution or program) first")
    if suggested:
        blockers.append(f"Review {suggested} suggested evidence item(s) first")
    if not confirmed and not stated:
        blockers.append("Confirm at least one evidence item or answer a chat question first")
    return {
        "student_id": student_id,
        "ready": not blockers,
        "blockers": blockers,
        "basics_done": profile is not None and bool(((profile.program or "").strip() or (profile.institution or "").strip())),
        "confirmed_evidence": confirmed,
        "stated_facts": stated,
        "suggested_pending": suggested,
        "chat_turns": chat_turns,
        "onboarding_status": profile.onboarding_status if profile else "basics",
    }
