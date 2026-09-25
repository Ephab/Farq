from __future__ import annotations

"""Step 3: review. The student's explicit confirm/dismiss decisions.

Ticking an item is an explicit statement by the student, so it is the
one non-chat path into StudentFact (source_kind="confirmed_evidence").
"""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import EvidenceItem, StudentFact

EVIDENCE_FACT_CATEGORY = {
    "course": "course", "education": "course", "skill": "skill", "project": "achievement",
    "experience": "achievement", "certificate": "achievement", "publication": "achievement", "activity": "achievement",
}


def decide_evidence(
    db: Session,
    student_id: str,
    confirm: list[str],
    dismiss: list[str],
    titles: dict[str, str] | None = None,
) -> dict:
    """Apply the student's review decisions. Returns {confirmed, dismissed} counts."""
    titles = titles or {}
    ids = set(confirm) | set(dismiss)
    items = {item.id: item for item in db.scalars(select(EvidenceItem).where(EvidenceItem.student_id == student_id, EvidenceItem.id.in_(ids))).all()}
    for evidence_id in dismiss:
        item = items.get(evidence_id)
        if item is None:
            continue
        item.status = "dismissed"
        for fact in db.scalars(select(StudentFact).where(StudentFact.evidence_id == evidence_id, StudentFact.active.is_(True))).all():
            fact.active = False
    confirmed = 0
    for evidence_id in confirm:
        item = items.get(evidence_id)
        if item is None or evidence_id in dismiss:
            continue
        title = titles.get(evidence_id, "").strip()
        if title:
            item.title = title[:240]
        item.status = "confirmed"
        for fact in db.scalars(select(StudentFact).where(StudentFact.evidence_id == evidence_id, StudentFact.active.is_(True))).all():
            fact.active = False
        data = json.loads(item.data_json)
        data.pop("readme_excerpt", None)
        db.add(StudentFact(
            student_id=student_id,
            category=EVIDENCE_FACT_CATEGORY[item.kind],
            key=f"{item.kind}: {item.title}"[:120],
            value_json=json.dumps({k: v for k, v in data.items() if v not in ("", [], None)}),
            source_kind="confirmed_evidence",
            evidence_id=item.id,
            confidence=100,
        ))
        confirmed += 1
    db.commit()
    return {"confirmed": confirmed, "dismissed": len([i for i in dismiss if i in items])}
