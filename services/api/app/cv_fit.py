"""CV x co-op posting fit score (app.cv's "Tailor to a co-op offer" / Fit panel).

Isolated Jev purpose: `cv_fit` is its own question set and its own call into
`decision_engines.ask_chain`, deliberately not routed through `decisions.py`'s shared
`observe_items`/`rerank` helpers (those are shaped for reranking a list of candidate items, not
scoring one CV against one posting) and not touching `coop_relevance.py` (the co-op agent's
module). Jev sees a narrow, redacted state — the CV's own skill/keyword text and the posting's
already-extracted requirements (coop_extraction.py) — and never the student's name or contact
details. It never writes product state; this module turns its score into the fit the student
sees. Fails open to a deterministic keyword-overlap score when no engine is configured.
"""

from __future__ import annotations

import json
import re

from . import decision_engines
from .coop_extraction import extracted_fields
from .models import CoopPosting
from .schemas import CvDocument

TOKEN = re.compile(r"[A-Za-z0-9+#.]+|[؀-ۿ]+")
MAX_MISSING = 8

FIT_QUESTIONS = {
    "fit": {
        "type": "score",
        "instructions": "How well does this CV's skills and experience match this co-op posting's requirements?",
        "criteria": ["poor fit", "excellent fit"],
    },
}


def _tokens(value: object) -> set[str]:
    raw = " ".join(str(item) for item in value) if isinstance(value, (list, tuple, set)) else str(value or "")
    return {item.lower() for item in TOKEN.findall(raw)}


def _skill_label(requirement: dict) -> str:
    return str(requirement.get("skill") or "").strip()


def cv_tokens(document: CvDocument) -> set[str]:
    """Every word on the CV (never the student's name/contact), for a redacted Jev state and the
    deterministic fallback match."""
    parts: list[str] = [document.contact.headline]
    for section in document.sections:
        if section.summary:
            parts.append(section.summary)
        for entry in section.entries or []:
            parts.append(entry.title)
            parts.append(entry.subtitle)
            parts.extend(bullet.text for bullet in entry.bullets)
        for group in section.skills or []:
            parts.append(group.label)
            parts.extend(group.items)
        for cert in section.certificates or []:
            parts.append(cert.name)
    return _tokens(parts)


def posting_state(extracted: dict) -> dict:
    return {
        "title": extracted.get("title", "")[:200],
        "disciplines": extracted.get("disciplines", []),
        "skill_requirements": [_skill_label(r) for r in extracted.get("skill_requirements", [])][:15],
    }


def _suggestion(skill: str) -> str:
    return f'Add a bullet or skill mentioning "{skill}" if you have related experience.'


def compute_cv_fit(document: CvDocument, posting: CoopPosting) -> dict:
    extracted = extracted_fields(posting)
    requirements = extracted.get("skill_requirements", [])
    known = cv_tokens(document)

    matched: list[str] = []
    missing: list[dict] = []
    for requirement in requirements:
        skill = _skill_label(requirement)
        if not skill:
            continue
        if _tokens(skill) & known:
            matched.append(skill)
        else:
            missing.append({"keyword": skill, "suggestion": _suggestion(skill)})

    score = round(100 * len(matched) / len(requirements)) if requirements else (60 if matched else 40)
    engine = "fallback"
    try:
        state = json.dumps({"cv_skills": sorted(known)[:60], "posting": posting_state(extracted)}, ensure_ascii=False)
        result = decision_engines.ask_chain(state, FIT_QUESTIONS)
        raw_score = result.payload.get("answers", {}).get("fit", {}).get("score")
        if isinstance(raw_score, (int, float)):
            score = max(0, min(100, round(float(raw_score) * 100)))
        engine = result.engine
    except decision_engines.EngineUnavailable:
        pass
    except Exception:
        pass

    return {"score": score, "matched": matched, "missing": missing[:MAX_MISSING], "engine": engine}
