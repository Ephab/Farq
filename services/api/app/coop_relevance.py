"""Per student x posting co-op relevance: Jev -> Span -> Laya, then a discipline-aware fallback.

AGENTS.md: Jev observes a narrow, redacted state (the student's discipline/program/skills and the
posting's extracted requirements — academic facts only, never an email or name) and never writes
product state directly. This module is the one place that turns its yes/no + fit score into the
persisted, student-facing decision: relevant/hidden, a fit score, a reason grounded in real
overlaps, and gaps traceable to the posting's own extracted requirements. Results are cached per
(student, posting) in CoopRelevance and only recomputed when the student's profile/skills or the
posting's extracted content actually changed (see fingerprints below), so a page load never pays
for more than a few fresh model calls (coop.py bounds `max_new` and fills the rest in the background).
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import decision_engines
from .coop_extraction import extracted_fields
from .models import CoopPosting, CoopRelevance, StudentFact, StudentProfile, now

TOKEN = re.compile(r"[A-Za-z0-9+#.]+|[؀-ۿ]+")
MAX_GAPS = 6

RELEVANCE_QUESTIONS = {
    "relevant": {
        "type": "choice",
        "instructions": "Given this student's discipline, program and demonstrated skills, is this co-op/internship posting relevant and worth showing them?",
        "criteria": {"yes": "clearly relevant, the student should see it", "no": "not relevant — wrong discipline, wrong seniority (e.g. a manager role), or asks for skills far outside the student's field"},
    },
    "fit": {
        "type": "score",
        "instructions": "How well does this posting fit this student's profile overall?",
        "criteria": ["poor fit", "excellent fit"],
    },
}


def _tokens(value: object) -> set[str]:
    raw = " ".join(str(item) for item in value) if isinstance(value, (list, tuple, set)) else str(value or "")
    return {item.lower() for item in TOKEN.findall(raw)}


def _skill_label(requirement: dict) -> str:
    return str(requirement.get("skill") or "").strip()


def _known_skill_tokens(db: Session, student_id: str) -> tuple[set[str], list[str]]:
    """Tokens from confirmed StudentFact skills/achievements/courses, plus the original (un-tokenized)
    labels for display. Deliberately the same categories coop.py's _signals() treats as "skill"."""
    labels: list[str] = []
    tokens: set[str] = set()
    rows = db.scalars(select(StudentFact).where(
        StudentFact.student_id == student_id, StudentFact.active.is_(True),
        StudentFact.category.in_(["skill", "strength", "course", "achievement"]),
    )).all()
    for fact in rows:
        try:
            value = json.loads(fact.value_json)
        except json.JSONDecodeError:
            value = fact.value_json
        text = " ".join(str(part) for part in (fact.key, value) if part)
        if text.strip():
            labels.append(text.strip())
        tokens.update(_tokens([fact.key, value]))
    return tokens, labels


def student_state(db: Session, student_id: str) -> dict:
    profile = db.get(StudentProfile, student_id)
    tokens, labels = _known_skill_tokens(db, student_id)
    return {
        "discipline": profile.discipline if profile else "other",
        "program": (profile.program if profile else "")[:120],
        "year_label": (profile.year_label if profile else "")[:40],
        "skills": sorted(tokens)[:40],
        "skill_labels": labels[:30],
    }


def posting_state(extracted: dict) -> dict:
    return {
        "title": extracted.get("title", "")[:200],
        "company": extracted.get("company", "")[:120],
        "disciplines": extracted.get("disciplines", []),
        "seniority": extracted.get("seniority", "unknown"),
        "skill_requirements": [_skill_label(r) for r in extracted.get("skill_requirements", [])][:15],
        "location": extracted.get("location", "")[:120],
    }


def _fingerprint(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _matched_skills(extracted: dict, known_tokens: set[str]) -> tuple[list[str], list[dict]]:
    matched: list[str] = []
    gaps_source: list[dict] = []
    for requirement in extracted.get("skill_requirements", []):
        skill = _skill_label(requirement)
        if not skill:
            continue
        if _tokens(skill) & known_tokens:
            matched.append(skill)
        else:
            gaps_source.append(requirement)
    return matched, gaps_source


def _suggestion_for(skill: str) -> dict:
    lowered = skill.lower()
    table = [
        (("python", "pytorch", "tensorflow", "machine learning", "deep learning", "nlp", "ml", "ai"), "course", "~2-3 weeks"),
        (("sql", "database", "warehouse"), "course", "~1 week"),
        (("docker", "kubernetes", "mlops", "devops", "ci/cd", "deployment"), "course", "~2-3 weeks"),
        (("bash", "linux", "shell", "scripting"), "course", "~2 weeks"),
        (("security", "siem", "soc", "penetration", "cyber"), "certificate", "~3 weeks"),
        (("research", "academic writing", "publication", "paper"), "practice", "~2 weeks"),
        (("clinical", "patient", "emr", "rotation", "acls"), "practice", "~1-2 weeks"),
        (("statistic", "biostat", "spss"), "course", "~3 weeks"),
        (("regulatory", "pharmacovigilance", "compliance", "ethics", "irb"), "course", "~2 weeks"),
        (("go", "golang", "kubernetes"), "course", "~1 week"),
    ]
    for keywords, kind, duration in table:
        if any(word in lowered for word in keywords):
            return {"title": f"Learn {skill}", "description": f"Close the {skill} gap this posting calls out.", "duration": duration, "kind": kind}
    return {"title": f"Learn {skill}", "description": f"Close the {skill} gap this posting calls out.", "duration": "~2 weeks", "kind": "course"}


def _gap(skill: str, why: str, importance: str) -> dict:
    return {
        "id": hashlib.sha256(skill.encode()).hexdigest()[:12],
        "skill": skill,
        "why": why,
        "importance": importance,
        "evidence_needed": f"A completed course, certificate, or project that demonstrates {skill}.",
        "suggestion": _suggestion_for(skill),
    }


def _build_gaps_and_eligibility(extracted: dict, known_tokens: set[str]) -> tuple[list[str], list[dict], list[dict]]:
    matched, unmatched_requirements = _matched_skills(extracted, known_tokens)
    gaps = []
    for requirement in unmatched_requirements:
        skill = _skill_label(requirement)
        quote = str(requirement.get("quote") or "").strip() or f"The posting asks for {skill}."
        importance = "high" if requirement.get("required", True) else "medium"
        gaps.append(_gap(skill, quote, importance))
    eligibility_checklist = []
    for item in extracted.get("eligibility_requirements", []):
        if item.get("learnable"):
            gaps.append(_gap("Language proficiency test prep", item.get("detail") or "A language/placement test is required to apply.", "medium"))
        else:
            eligibility_checklist.append({"type": item.get("type", "other"), "detail": item.get("detail", "")})
    return matched, gaps[:MAX_GAPS], eligibility_checklist


DISCIPLINE_LABELS = {
    "cs": "computer science / AI", "engineering": "engineering", "medicine": "medicine", "law": "law",
    "business": "business", "sciences": "sciences", "design": "design", "other": "another discipline",
}


def _fallback_decision(discipline: str, extracted: dict, matched: list[str], total_requirements: int) -> tuple[bool, int, str]:
    """Discipline-aware heuristic used when Jev -> Span -> Laya are all unavailable. `engine` label
    lets callers (and tests) tell a real model decision from this fallback."""
    seniority = extracted.get("seniority", "unknown")
    if seniority in {"manager", "senior"}:
        return False, 5, "fallback"
    disciplines = extracted.get("disciplines", [])
    discipline_ok = not disciplines or discipline in disciplines
    if not discipline_ok and not matched:
        return False, 12, "fallback"
    score = 30
    if total_requirements:
        score += round(55 * (len(matched) / total_requirements))
    else:
        score += 20
    if discipline_ok:
        score += 15
    return True, min(score, 96), "fallback"


def _reason_text(matched: list[str], discipline: str, extracted: dict) -> str:
    if matched:
        return f"Uses your {', '.join(matched[:2])} experience"
    disciplines = extracted.get("disciplines", [])
    if discipline in disciplines:
        return f"Written for {DISCIPLINE_LABELS.get(discipline, discipline)} students like you"
    if not disciplines:
        return "Open to students from any discipline"
    return "Matches your program"


def _hidden_reason(discipline: str, extracted: dict, matched: list[str]) -> str:
    seniority = extracted.get("seniority", "unknown")
    if seniority in {"manager", "senior"}:
        return f"{seniority.title()}-level role — not an internship or co-op position"
    disciplines = extracted.get("disciplines", [])
    if disciplines and discipline not in disciplines and not matched:
        named = [code for code in disciplines if code != "other"]
        if not named:
            return "Written for a different field than yours"
        labels = ", ".join(DISCIPLINE_LABELS.get(code, code) for code in named[:2])
        return f"Targets {labels} students"
    return "Does not match your profile closely enough"


# Bump to re-score every cached row when the scoring rules below change.
SCORING_VERSION = 3
# Adjacent majors: shown, but never as a top match on discipline alone.
ADJACENT_DISCIPLINES = {"cs": {"engineering"}, "engineering": {"cs"}, "sciences": {"medicine"}, "medicine": {"sciences"}}


def _discipline_guard(discipline: str, extracted: dict, matched: list[str], relevant: bool, fit_score: int) -> tuple[bool, int]:
    """Keeps the engine's score honest about who a posting is written for: a posting whose target
    majors exclude the student's is hidden (an adjacent major is kept but capped), and a broad
    "every major, soft skills only" program never reads as a near-perfect fit."""
    targets = [code for code in extracted.get("disciplines", []) if code != "other"]
    if targets and discipline not in targets:
        if ADJACENT_DISCIPLINES.get(discipline, set()) & set(targets):
            return relevant, min(fit_score, 60)
        if not matched:
            return False, min(fit_score, 15)
    if len(targets) >= 3 and not matched:
        return relevant, min(fit_score, 70)
    return relevant, fit_score


def _ordered_targets(discipline: str, extracted: dict) -> list[str]:
    """The student's own major first, so the card never says "written for business students"
    for a posting that also targets them."""
    targets = list(extracted.get("disciplines", []))
    return sorted(targets, key=lambda code: code != discipline)


def compute_relevance(db: Session, student_id: str, posting: CoopPosting, *, force: bool = False) -> CoopRelevance:
    extracted = extracted_fields(posting)
    s_state = student_state(db, student_id)
    known_tokens = set(s_state["skills"])
    p_state = posting_state(extracted)

    student_fp = _fingerprint(s_state)
    posting_fp = _fingerprint({"v": SCORING_VERSION, "hash": posting.raw_hash, "extracted": extracted})

    existing = db.scalar(select(CoopRelevance).where(CoopRelevance.student_id == student_id, CoopRelevance.posting_id == posting.id))
    if existing and not force and existing.student_fingerprint == student_fp and existing.posting_fingerprint == posting_fp:
        return existing

    matched, gaps, eligibility = _build_gaps_and_eligibility(extracted, known_tokens)
    total_requirements = len(extracted.get("skill_requirements", []))

    engine = "fallback"
    try:
        state = json.dumps({"student": s_state, "posting": p_state}, ensure_ascii=False)
        result = decision_engines.ask_chain(state, RELEVANCE_QUESTIONS)
        answers = result.payload.get("answers", {})
        relevant = str(answers.get("relevant", {}).get("choice", "")).lower() == "yes"
        raw_score = answers.get("fit", {}).get("score")
        fit_score = max(0, min(100, round(float(raw_score) * 100))) if isinstance(raw_score, (int, float)) else 50
        engine = result.engine
    except decision_engines.EngineUnavailable:
        relevant, fit_score, engine = _fallback_decision(s_state["discipline"], extracted, matched, total_requirements)
    except Exception:
        relevant, fit_score, engine = _fallback_decision(s_state["discipline"], extracted, matched, total_requirements)

    # A manager/senior role or a hard discipline mismatch overrides an engine's "yes" — Jev sees a
    # redacted summary, not the full text, so this guard keeps a mislabeled seniority from leaking in.
    if extracted.get("seniority") in {"manager", "senior"}:
        relevant, fit_score = False, min(fit_score, 10)
    relevant, fit_score = _discipline_guard(s_state["discipline"], extracted, matched, relevant, fit_score)

    reason_text = _reason_text(matched, s_state["discipline"], extracted) if relevant else ""
    hidden_reason = _hidden_reason(s_state["discipline"], extracted, matched) if not relevant else None
    if not relevant:
        gaps = []

    if existing is None:
        existing = CoopRelevance(student_id=student_id, posting_id=posting.id)
        db.add(existing)
    existing.engine = engine
    existing.relevant = relevant
    existing.fit_score = fit_score
    existing.reason_text = reason_text
    existing.hidden_reason = hidden_reason
    existing.matched_json = json.dumps(matched, ensure_ascii=False)
    existing.gaps_json = json.dumps(gaps, ensure_ascii=False)
    existing.eligibility_json = json.dumps(eligibility, ensure_ascii=False)
    existing.target_disciplines_json = json.dumps(_ordered_targets(s_state["discipline"], extracted), ensure_ascii=False)
    existing.student_fingerprint = student_fp
    existing.posting_fingerprint = posting_fp
    existing.computed_at = now()
    return existing


def _is_fresh(db: Session, student_id: str, posting: CoopPosting, existing: CoopRelevance) -> bool:
    student_fp = _fingerprint(student_state(db, student_id))
    posting_fp = _fingerprint({"v": SCORING_VERSION, "hash": posting.raw_hash, "extracted": extracted_fields(posting)})
    return existing.student_fingerprint == student_fp and existing.posting_fingerprint == posting_fp


def ensure_relevance(db: Session, student_id: str, postings: list[CoopPosting], max_new: int = 6) -> dict[str, CoopRelevance]:
    """Reuse cached rows that are still fresh; (re)compute at most `max_new` stale/missing ones now
    (bounds first-load latency against Jev). A posting beyond that budget is simply left out —
    coop.py's formatting layer falls back to a neutral "not yet scored" entry for it, and a
    background pass (also calling this function) fills it in without blocking any request."""
    results: dict[str, CoopRelevance] = {}
    budget = max_new
    for posting in postings:
        if posting.is_demo:
            continue
        existing = db.scalar(select(CoopRelevance).where(CoopRelevance.student_id == student_id, CoopRelevance.posting_id == posting.id))
        if existing is not None and _is_fresh(db, student_id, posting, existing):
            results[posting.id] = existing
            continue
        if budget <= 0:
            if existing is not None:
                results[posting.id] = existing
            continue
        results[posting.id] = compute_relevance(db, student_id, posting, force=True)
        budget -= 1
        # Commit per posting: the model call above must never run inside an open SQLite write
        # transaction, or a concurrent request's write fails with "database is locked".
        db.commit()
    return results


def relevance_dict(row: CoopRelevance) -> dict:
    return {
        "relevant": row.relevant,
        "fit_score": row.fit_score,
        "reason_text": row.reason_text,
        "hidden_reason": row.hidden_reason,
        "matched": json.loads(row.matched_json or "[]"),
        "gaps": json.loads(row.gaps_json or "[]"),
        "eligibility": json.loads(row.eligibility_json or "[]"),
        "target_disciplines": json.loads(row.target_disciplines_json or "[]"),
        "engine": row.engine,
        "computed_at": row.computed_at.isoformat(),
    }


def default_relevance_dict() -> dict:
    """Used for postings not yet computed at all (beyond this call's `max_new` budget): shown as a
    plain "explore" entry with no gaps claimed, rather than blocking the response."""
    return {
        "relevant": True, "fit_score": 40, "reason_text": "Not yet reviewed by Jev — showing it for now",
        "hidden_reason": None, "matched": [], "gaps": [], "eligibility": [], "target_disciplines": [],
        "engine": "unscored", "computed_at": None,
    }
