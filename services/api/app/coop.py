"""Personalized Saudi co-op discovery through bounded, official sources."""

from __future__ import annotations

import hashlib
import json
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .internal_auth import require_internal
from .ownership import OwnedStudent
from .tool_grants import ReadGrant, student_for
from .database import get_db
from .decisions import DecisionItem, observe_items, rerank
from .coop_sources import CoopCandidate, fetch_linkedin_candidates, fetch_telegram_candidates
from .models import CoopCompany, CoopPosting, CoopPostingSource, OpportunitySyncRun, Project, RoadmapVersion, Student, StudentCoopState, StudentFact, StudentProfile, now

router = APIRouter()
Db = Annotated[Session, Depends(get_db)]
TOKEN = re.compile(r"[A-Za-z0-9+#.]+|[\u0600-\u06ff]+")
SOURCE_LABELS = {"official": "Official", "telegram": "Telegram", "linkedin": "LinkedIn", "demo": "Demo"}
ALLOWED_SOURCE_HOSTS = {
    "careers.tahakom.com", "sdaia.gov.sa", "www.sdaia.gov.sa", "careers.kaust.edu.sa",
    "kacst.gov.sa", "www.kacst.gov.sa", "careers.elm.sa", "careers.stc.com.sa",
    "aramco.com", "www.aramco.com", "mozn.sa", "www.mozn.sa",
}

COMPANIES = [
    {
        "slug": "tahakom", "name": "Tahakom", "orientation": "industry",
        "overview": "Urban intelligence, smart mobility and national-scale technology systems.",
        "sectors": ["govtech", "smart cities", "mobility", "ai", "cybersecurity"],
        "skills": ["python", "systems", "computer vision", "data", "cloud", "cybersecurity"],
        "tracks": ["software engineering", "AI and data", "cybersecurity", "IoT"], "locations": ["Riyadh"],
        "company_url": "https://www.tahakom.com/", "careers_url": "https://careers.tahakom.com/",
        "source_url": "https://careers.tahakom.com/go/%D8%A7%D9%84%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8-%D8%A7%D9%84%D8%AA%D8%B9%D8%A7%D9%88%D9%86%D9%8A-%D9%88%D8%A8%D8%B1%D8%A7%D9%85%D8%AC-%D8%A7%D9%84%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8/4388723/",
    },
    {
        "slug": "sdaia-jrcai", "name": "SDAIA / JRCAI", "orientation": "research",
        "overview": "National AI, data and applied research programs with public-sector impact.",
        "sectors": ["ai", "research", "data", "govtech", "arabic ai"],
        "skills": ["machine learning", "deep learning", "python", "research", "nlp", "data"],
        "tracks": ["AI research", "data science", "AI engineering"], "locations": ["Riyadh"],
        "company_url": "https://sdaia.gov.sa/", "careers_url": "https://careers.sdaia.gov.sa/",
        "source_url": "https://sdaia.gov.sa/en/Services/Pages/ServiceDetails.aspx?ServiceID=17",
    },
    {
        "slug": "kaust", "name": "KAUST", "orientation": "research",
        "overview": "Research-intensive university working across AI, robotics, energy, biology and scientific computing.",
        "sectors": ["research", "ai", "robotics", "bioinformatics", "energy", "science"],
        "skills": ["research", "python", "machine learning", "mathematics", "scientific computing"],
        "tracks": ["Research engineering", "AI research", "Scientific computing"], "locations": ["Thuwal"],
        "company_url": "https://www.kaust.edu.sa/", "careers_url": "https://careers.kaust.edu.sa/",
        "source_url": "https://careers.kaust.edu.sa/",
    },
    {
        "slug": "kacst", "name": "KACST", "orientation": "research",
        "overview": "Applied science and technology research supporting national innovation.",
        "sectors": ["research", "ai", "space", "energy", "cybersecurity"],
        "skills": ["research", "python", "data", "systems", "machine learning"],
        "tracks": ["Research", "Software and data", "Scientific engineering"], "locations": ["Riyadh"],
        "company_url": "https://www.kacst.gov.sa/", "careers_url": "https://www.kacst.gov.sa/coop",
        "source_url": "https://www.kacst.gov.sa/coop",
    },
    {
        "slug": "elm", "name": "Elm", "orientation": "industry",
        "overview": "Saudi digital products and government platforms at national scale.",
        "sectors": ["govtech", "digital products", "data", "cybersecurity"],
        "skills": ["software engineering", "systems", "cloud", "data", "product"],
        "tracks": ["Software engineering", "Product", "Data", "Cybersecurity"], "locations": ["Riyadh"],
        "company_url": "https://www.elm.sa/", "careers_url": "https://careers.elm.sa/", "source_url": "https://careers.elm.sa/",
    },
    {
        "slug": "stc", "name": "stc", "orientation": "industry",
        "overview": "Telecommunications, cloud, cybersecurity, data and digital services.",
        "sectors": ["telecom", "cloud", "cybersecurity", "data", "digital products"],
        "skills": ["networks", "cloud", "software engineering", "data", "cybersecurity"],
        "tracks": ["Technology", "Engineering", "Data", "Cybersecurity"], "locations": ["Riyadh"],
        "company_url": "https://www.stc.com.sa/", "careers_url": "https://careers.stc.com.sa/",
        "source_url": "https://careers.stc.com.sa/content/COOP/?locale=en_US",
    },
    {
        "slug": "aramco", "name": "Aramco", "orientation": "industry",
        "overview": "Large-scale energy technology, industrial systems, data and cybersecurity.",
        "sectors": ["energy", "industrial", "data", "cybersecurity", "engineering"],
        "skills": ["systems", "data", "cybersecurity", "software engineering", "iot"],
        "tracks": ["Digital technology", "Industrial systems", "Data"], "locations": ["Dhahran"],
        "company_url": "https://www.aramco.com/", "careers_url": "https://www.aramco.com/en/careers",
        "source_url": "https://www.aramco.com/en/careers/for-saudi-applicants/student-opportunities",
    },
    {
        "slug": "mozn", "name": "Mozn", "orientation": "industry",
        "overview": "AI-native products for risk, compliance and Arabic language intelligence.",
        "sectors": ["ai", "fintech", "nlp", "data", "software"],
        "skills": ["machine learning", "nlp", "python", "backend", "data"],
        "tracks": ["Machine learning", "Software engineering", "Data"], "locations": ["Riyadh"],
        "company_url": "https://www.mozn.sa/", "careers_url": "https://www.mozn.sa/careers", "source_url": "https://www.mozn.sa/careers",
    },
]

DEMO_POSTINGS = [
    ("tahakom", "demo-tahakom-coop", "Cooperative Training — Technology", "Riyadh", ["software engineering", "ai", "data"], ["University co-op requirement"], "https://careers.tahakom.com/"),
    ("sdaia-jrcai", "demo-sdaia-ai", "Cooperative Training — AI & Data", "Riyadh", ["machine learning", "python", "data"], ["University student", "Co-op training letter"], "https://sdaia.gov.sa/ar/Sectors/BuildingCapacity/Pages/CooperativeTraining.aspx"),
    ("kacst", "demo-kacst-research", "Cooperative Training — Research Technology", "Riyadh", ["research", "python", "systems"], ["Bachelor student", "Academic transcript", "Training letter"], "https://www.kacst.gov.sa/coop"),
]


class CoopStateInput(BaseModel):
    status: Literal["saved", "dismissed", "neutral"]


def _json(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
        return [str(item) for item in parsed] if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _tokens(value: object) -> set[str]:
    raw = " ".join(str(item) for item in value) if isinstance(value, (list, tuple, set)) else str(value or "")
    found = {item.lower() for item in TOKEN.findall(raw)}
    aliases = {
        "ai": {"ai", "artificial", "machine", "deep", "vision", "nlp", "ذكاء"},
        "software engineering": {"software", "backend", "frontend", "programming", "coding", "برمجة"},
        "research": {"research", "paper", "publication", "بحث", "أبحاث"},
        "cybersecurity": {"cyber", "security", "cybersecurity", "سيبراني", "أمن"},
        "systems": {"system", "systems", "distributed", "docker", "cloud", "architecture"},
        "data": {"data", "analytics", "database", "بيانات"},
        "govtech": {"govtech", "government", "public", "حكومي"},
    }
    expanded = set(found)
    for canonical, words in aliases.items():
        if found.intersection(words):
            expanded.add(canonical)
    return expanded


def seed_coop_catalog(db: Session) -> None:
    for record in COMPANIES:
        company = db.get(CoopCompany, record["slug"])
        if company is None:
            company = CoopCompany(slug=record["slug"], name=record["name"])
            db.add(company)
        company.name = record["name"]
        company.overview = record["overview"]
        company.sectors_json = json.dumps(record["sectors"])
        company.skills_json = json.dumps(record["skills"])
        company.tracks_json = json.dumps(record["tracks"])
        company.locations_json = json.dumps(record["locations"])
        company.orientation = record["orientation"]
        company.company_url = record["company_url"]
        company.careers_url = record["careers_url"]
        company.source_url = record["source_url"]
        company.active = True
    db.flush()
    for company_slug, external_id, title, location, skills, requirements, url in DEMO_POSTINGS:
        posting = db.scalar(select(CoopPosting).where(CoopPosting.source == "demo", CoopPosting.external_id == external_id))
        if posting is None:
            payload = json.dumps([company_slug, title, skills], sort_keys=True)
            db.add(CoopPosting(
                company_slug=company_slug, source="demo", external_id=external_id, title=title,
                description="Demo opportunity used when an official source has no machine-readable live listing.",
                location=location, skills_json=json.dumps(skills), requirements_json=json.dumps(requirements),
                detail_url=url, apply_url="", status="unknown", source_status="demo", is_demo=True,
                raw_hash=hashlib.sha256(payload.encode()).hexdigest(),
            ))
    db.commit()


def _slug(value: str) -> str:
    latin = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if latin:
        return latin[:64]
    return f"company-{hashlib.sha256(value.encode()).hexdigest()[:12]}"


def _normalized_url(value: str) -> str:
    if not value:
        return ""
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    path = re.sub(r"/+$", "", parsed.path)
    return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}{path}"


def _canonical_key(candidate: CoopCandidate) -> str:
    normalize = lambda value: re.sub(r"[^a-z0-9\u0600-\u06ff]+", " ", value.lower()).strip()
    material = "|".join((normalize(candidate.company), normalize(candidate.title), normalize(candidate.location)))
    return hashlib.sha256(material.encode()).hexdigest()


def _company_for_candidate(db: Session, candidate: CoopCandidate) -> CoopCompany:
    wanted = re.sub(r"[^a-z0-9\u0600-\u06ff]", "", candidate.company.lower())
    for company in db.scalars(select(CoopCompany)).all():
        known = re.sub(r"[^a-z0-9\u0600-\u06ff]", "", company.name.lower())
        if wanted and (wanted == known or wanted in known or known in wanted):
            skills = list(dict.fromkeys(_json(company.skills_json) + candidate.skills))
            locations = list(dict.fromkeys(_json(company.locations_json) + ([candidate.location] if candidate.location else [])))
            company.skills_json = json.dumps(skills)
            company.locations_json = json.dumps(locations)
            company.fetched_at = now()
            return company
    slug = _slug(candidate.company)
    existing = db.get(CoopCompany, slug)
    if existing:
        return existing
    company = CoopCompany(
        slug=slug, name=candidate.company[:180], overview="Discovered through a public co-op listing.",
        sectors_json="[]", skills_json=json.dumps(candidate.skills), tracks_json="[]",
        locations_json=json.dumps([candidate.location] if candidate.location else []), orientation="industry",
        company_url="", careers_url=candidate.apply_url, source_url=candidate.detail_url,
        source_status="listed", active=True, fetched_at=now(),
    )
    db.add(company)
    db.flush()
    return company


def _upsert_candidate(db: Session, candidate: CoopCandidate) -> tuple[str, CoopPosting]:
    observed = now()
    provenance = db.scalar(select(CoopPostingSource).where(
        CoopPostingSource.source == candidate.source,
        CoopPostingSource.external_id == candidate.external_id,
    ))
    key = _canonical_key(candidate)
    posting = db.get(CoopPosting, provenance.posting_id) if provenance else None
    if posting is None:
        candidate_url = _normalized_url(candidate.apply_url)
        if candidate_url:
            posting = next((item for item in db.scalars(select(CoopPosting)).all() if _normalized_url(item.apply_url) == candidate_url), None)
    if posting is None:
        posting = db.scalar(select(CoopPosting).where(CoopPosting.canonical_key == key))
    action = "updated" if posting else "inserted"
    company = _company_for_candidate(db, candidate)
    if posting is None:
        posting = CoopPosting(
            company_slug=company.slug, source=candidate.source, external_id=candidate.external_id,
            title=candidate.title[:300], canonical_key=key,
        )
        db.add(posting)
        db.flush()
    elif provenance is None:
        action = "merged"
    posting.company_slug = company.slug
    posting.title = candidate.title[:300] or posting.title
    posting.description = candidate.description or posting.description
    posting.location = candidate.location or posting.location
    posting.skills_json = json.dumps(candidate.skills) if candidate.skills else posting.skills_json
    posting.requirements_json = json.dumps(candidate.requirements) if candidate.requirements else posting.requirements_json
    posting.opens_at = candidate.opens_at or posting.opens_at
    posting.closes_at = candidate.closes_at or posting.closes_at
    posting.detail_url = candidate.detail_url or posting.detail_url
    posting.apply_url = candidate.apply_url or posting.apply_url
    posting.status = "listed"
    posting.source_status = candidate.source_status
    posting.is_demo = False
    posting.active = True
    posting.raw_hash = candidate.raw_hash
    posting.canonical_key = key
    posting.published_at = candidate.published_at or posting.published_at
    posting.last_seen_at = observed
    posting.fetched_at = observed
    if provenance is None:
        provenance = CoopPostingSource(posting_id=posting.id, source=candidate.source, external_id=candidate.external_id)
        db.add(provenance)
    provenance.detail_url = candidate.detail_url
    provenance.apply_url = candidate.apply_url
    provenance.source_status = candidate.source_status
    provenance.raw_hash = candidate.raw_hash
    provenance.metadata_json = json.dumps(candidate.metadata, ensure_ascii=False)
    provenance.published_at = candidate.published_at
    provenance.last_seen_at = observed
    return action, posting


def sync_coop_source(db: Session, source: Literal["telegram", "linkedin"], client: httpx.Client | None = None) -> dict:
    run = OpportunitySyncRun(source=f"coop:{source}")
    db.add(run)
    db.commit()
    counts = {"inserted": 0, "updated": 0, "merged": 0}
    try:
        has_history = db.scalar(select(CoopPostingSource.id).where(CoopPostingSource.source == source).limit(1)) is not None
        candidates = fetch_telegram_candidates(client, pages=1 if has_history else 3) if source == "telegram" else fetch_linkedin_candidates(client)
        observe_items(db, [DecisionItem(
            entity_type=f"coop_{source}", entity_id=candidate.external_id, title=candidate.title,
            text=f"{candidate.company}. {candidate.location}. {candidate.description}",
        ) for candidate in candidates], purpose="coop_ingestion")
        for candidate in candidates:
            action, _ = _upsert_candidate(db, candidate)
            counts[action] += 1
        if source == "linkedin":
            cutoff = now() - timedelta(days=7)
            stale = db.scalars(select(CoopPostingSource).where(
                CoopPostingSource.source == source,
                CoopPostingSource.last_seen_at < cutoff,
            )).all()
            for record in stale:
                other_current = db.scalar(select(CoopPostingSource.id).where(
                    CoopPostingSource.posting_id == record.posting_id,
                    CoopPostingSource.last_seen_at >= cutoff,
                ).limit(1))
                if other_current is None:
                    posting = db.get(CoopPosting, record.posting_id)
                    if posting:
                        posting.active = False
        run.status = "completed"
        run.fetched_count = len(candidates)
        run.changed_count = counts["inserted"] + counts["merged"]
        run.finished_at = now()
        db.commit()
        return {"source": source, "status": "completed", "fetched": len(candidates), **counts}
    except Exception as exc:
        db.rollback()
        run = db.get(OpportunitySyncRun, run.id)
        run.status = "failed"
        run.error = str(exc)[:1000]
        run.finished_at = now()
        db.commit()
        return {"source": source, "status": "failed", "fetched": 0, **counts, "error": str(exc)}


def sync_all_coop_sources(db: Session) -> dict:
    results = {"official": sync_official_coop_sources(db)}
    if os.getenv("COOP_TELEGRAM_ARCHIVE_ENABLED", "true").lower() in {"1", "true", "yes"}:
        results["telegram"] = sync_coop_source(db, "telegram")
    if os.getenv("COOP_LINKEDIN_ENABLED", "true").lower() in {"1", "true", "yes"}:
        results["linkedin"] = sync_coop_source(db, "linkedin")
    return results


def sync_official_coop_sources(db: Session, client: httpx.Client | None = None) -> dict:
    """Refresh source availability without treating a program page as an open vacancy."""
    owned = client is None
    session = client or httpx.Client(timeout=12, follow_redirects=True, headers={"User-Agent": "Waypoint/0.1 co-op discovery"})
    changed = 0
    failures: list[str] = []
    try:
        for company in db.scalars(select(CoopCompany).where(CoopCompany.active.is_(True))).all():
            parsed = urlparse(company.source_url)
            if parsed.scheme != "https" or parsed.hostname not in ALLOWED_SOURCE_HOSTS:
                failures.append(company.slug)
                continue
            try:
                response = session.get(company.source_url)
                response.raise_for_status()
                if response.url.host not in ALLOWED_SOURCE_HOSTS:
                    raise ValueError("source redirected outside the allowlist")
                if len(response.content) > 2_000_000:
                    raise ValueError("response too large")
                kind = response.headers.get("content-type", "").lower()
                if "html" not in kind:
                    raise ValueError("source did not return HTML")
                text = re.sub(r"\s+", " ", response.text).lower()
                closed = any(phrase in text for phrase in ("no current openings", "no jobs matched", "لا توجد حاليًا أي شواغر", "applications are now filled"))
                open_now = any(phrase in text for phrase in ("apply now", "register now", "التسجيل في التدريب", "ابدأ الخدمة")) and not closed
                next_status = "closed" if closed else "verified_open" if open_now else "program_page"
                if company.source_status != next_status:
                    changed += 1
                company.source_status = next_status
                company.fetched_at = now()
                official_source = f"official:{company.slug}"
                posting = db.scalar(select(CoopPosting).where(CoopPosting.source == official_source, CoopPosting.external_id == "official-program"))
                if open_now:
                    digest = hashlib.sha256(response.content).hexdigest()
                    if posting is None:
                        posting = CoopPosting(
                            company_slug=company.slug, source=official_source, external_id="official-program",
                            title=f"{company.name} Cooperative Training", location=(_json(company.locations_json) or [""])[0],
                        )
                        db.add(posting)
                    posting.description = f"Current cooperative-training entry detected on {company.name}'s official source."
                    posting.skills_json = company.skills_json
                    posting.requirements_json = "[]"
                    posting.detail_url = company.source_url
                    posting.apply_url = company.source_url
                    posting.status = "verified_open"
                    posting.source_status = "verified_open"
                    posting.is_demo = False
                    posting.active = True
                    posting.raw_hash = digest
                    posting.fetched_at = now()
                elif posting is not None:
                    posting.active = False
                    posting.status = "closed" if closed else "unknown"
            except (httpx.HTTPError, ValueError):
                failures.append(company.slug)
        db.commit()
    finally:
        if owned:
            session.close()
    return {"status": "partial" if failures else "completed", "changed": changed, "failures": failures}


def _signals(db: Session, student_id: str) -> tuple[set[str], set[str], str, set[str]]:
    profile = db.get(StudentProfile, student_id)
    interests = _tokens([profile.program if profile else "", profile.discipline if profile else ""])
    skills: set[str] = set()
    preferences: set[str] = set()
    orientation = "undecided"
    for fact in db.scalars(select(StudentFact).where(StudentFact.student_id == student_id, StudentFact.active.is_(True))).all():
        try:
            value = json.loads(fact.value_json)
        except json.JSONDecodeError:
            value = fact.value_json
        tokens = _tokens([fact.key, value])
        if fact.category in {"skill", "strength", "course", "achievement"}:
            skills.update(tokens)
        elif fact.category in {"interest", "goal"}:
            interests.update(tokens)
        elif fact.category == "preference":
            preferences.update(tokens)
        if "research" in tokens:
            orientation = "research"
        elif tokens.intersection({"industry", "job", "startup"}) and orientation == "undecided":
            orientation = "industry"
    roadmap = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    if roadmap:
        try:
            for node in json.loads(roadmap.snapshot_json).get("nodes", []):
                node_tokens = _tokens([node.get("title"), node.get("tagline"), node.get("subtopics", [])])
                if node.get("status") in {"done", "in-progress"}:
                    skills.update(node_tokens)
                else:
                    interests.update(node_tokens)
        except (json.JSONDecodeError, AttributeError):
            pass
    for project in db.scalars(select(Project).where(Project.student_id == student_id)).all():
        tokens = _tokens([project.title, project.discipline, project.project_type])
        interests.update(tokens)
        if project.lifecycle == "completed" or project.latest_score is not None:
            skills.update(tokens)
    return interests, skills, orientation, preferences


def _state(db: Session, student_id: str, target_type: str, target_id: str) -> str:
    item = db.scalar(select(StudentCoopState).where(StudentCoopState.student_id == student_id, StudentCoopState.target_type == target_type, StudentCoopState.target_id == target_id))
    return item.status if item else "neutral"


def _fit(company: CoopCompany, signals: tuple[set[str], set[str], str, set[str]]) -> tuple[int, list[str], list[str]]:
    interests, skills, orientation, preferences = signals
    domains = _tokens(_json(company.sectors_json) + _json(company.tracks_json))
    wanted = _tokens(_json(company.skills_json))
    locations = _tokens(_json(company.locations_json))
    reasons: list[str] = []
    score = 20
    skill_hits = sorted(skills.intersection(wanted))
    interest_hits = sorted(interests.intersection(domains | wanted))
    if skill_hits:
        score += min(35, 12 + len(skill_hits) * 6)
        reasons.append(f"Uses your {', '.join(skill_hits[:2])} experience")
    if interest_hits:
        score += min(25, 8 + len(interest_hits) * 5)
        reasons.append(f"Matches your interest in {', '.join(interest_hits[:2])}")
    if orientation != "undecided" and company.orientation == orientation:
        score += 15
        reasons.append(f"Fits your {orientation}-focused direction")
    if preferences.intersection(locations):
        score += 5
        reasons.append("Matches your location preference")
    gaps = [item for item in _json(company.skills_json) if not _tokens(item).intersection(skills)][:3]
    if not reasons:
        reasons.append("Offers a path connected to your current program")
    return min(score, 100), reasons[:3], gaps


def _tier(score: int) -> str:
    return "Strong match" if score >= 75 else "Good match" if score >= 50 else "Explore"


def company_result(db: Session, student_id: str, company: CoopCompany, signals=None) -> dict:
    score, reasons, gaps = _fit(company, signals or _signals(db, student_id))
    postings = db.scalars(select(CoopPosting).where(CoopPosting.company_slug == company.slug, CoopPosting.active.is_(True))).all()
    verified = [item for item in postings if item.status == "verified_open" and not item.is_demo]
    return {
        "id": company.slug, "name": company.name, "overview": company.overview,
        "sectors": _json(company.sectors_json), "skills": _json(company.skills_json), "tracks": _json(company.tracks_json),
        "locations": _json(company.locations_json), "orientation": company.orientation,
        "company_url": company.company_url, "careers_url": company.careers_url, "source_url": company.source_url,
        "source_status": company.source_status, "fetched_at": company.fetched_at.isoformat(),
        "fit_score": score, "fit_tier": _tier(score), "reasons": reasons, "gaps": gaps,
        "verified_openings": len(verified), "state": _state(db, student_id, "company", company.slug),
    }


def posting_result(db: Session, student_id: str, posting: CoopPosting, signals=None) -> dict:
    company = db.get(CoopCompany, posting.company_slug)
    resolved_signals = signals or _signals(db, student_id)
    base = company_result(db, student_id, company, resolved_signals) if company else {"fit_score": 0, "fit_tier": "Explore", "reasons": [], "gaps": []}
    posting_hits = sorted((resolved_signals[0] | resolved_signals[1]).intersection(_tokens(_json(posting.skills_json))))
    if posting_hits:
        base = {**base, "fit_score": min(100, base["fit_score"] + min(12, len(posting_hits) * 4))}
        base["fit_tier"] = _tier(base["fit_score"])
        base["reasons"] = ([f"The role mentions {', '.join(posting_hits[:2])}"] + base["reasons"])[:3]
    records = db.scalars(select(CoopPostingSource).where(CoopPostingSource.posting_id == posting.id)).all()
    sources = [{
        "name": item.source,
        "label": SOURCE_LABELS.get(item.source, item.source.title()),
        "detail_url": item.detail_url,
        "apply_url": item.apply_url,
        "status": item.source_status,
        "published_at": item.published_at.isoformat() if item.published_at else None,
        "last_seen_at": item.last_seen_at.isoformat(),
    } for item in records]
    if not sources:
        source_name = posting.source.split(":", 1)[0]
        sources = [{
            "name": source_name, "label": SOURCE_LABELS.get(source_name, source_name.title()),
            "detail_url": posting.detail_url, "apply_url": posting.apply_url,
            "status": posting.source_status, "published_at": posting.published_at.isoformat() if posting.published_at else None,
            "last_seen_at": (posting.last_seen_at or posting.fetched_at).isoformat(),
        }]
    freshest = posting.last_seen_at or posting.fetched_at
    age = datetime.now(timezone.utc) - (freshest if freshest.tzinfo else freshest.replace(tzinfo=timezone.utc))
    freshness = "today" if age < timedelta(days=1) else "recent" if age < timedelta(days=7) else "older"
    return {
        "id": posting.id, "company_id": posting.company_slug, "company_name": company.name if company else posting.company_slug,
        "title": posting.title, "description": posting.description, "location": posting.location,
        "skills": _json(posting.skills_json), "requirements": _json(posting.requirements_json),
        "opens_at": posting.opens_at, "closes_at": posting.closes_at, "detail_url": posting.detail_url,
        "apply_url": posting.apply_url, "status": posting.status, "source_status": posting.source_status,
        "source": posting.source, "sources": sources, "is_demo": posting.is_demo,
        "published_at": posting.published_at.isoformat() if posting.published_at else None,
        "last_seen_at": freshest.isoformat(), "freshness": freshness,
        "deadline_confidence": "explicit" if posting.closes_at else "unknown",
        "fetched_at": posting.fetched_at.isoformat(),
        "fit_score": base["fit_score"], "fit_tier": base["fit_tier"], "reasons": base["reasons"], "gaps": base["gaps"],
        "state": _state(db, student_id, "posting", posting.id),
    }


def find_companies(db: Session, student_id: str, query: str = "", status: str = "all", limit: int = 20) -> list[dict]:
    signals = _signals(db, student_id)
    query_tokens = _tokens(query)
    results = []
    for company in db.scalars(select(CoopCompany).where(CoopCompany.active.is_(True))).all():
        result = company_result(db, student_id, company, signals)
        haystack = _tokens([result["name"], result["sectors"], result["tracks"], result["locations"]])
        if query_tokens and not query_tokens.intersection(haystack):
            continue
        if status != "all" and result["state"] != status:
            continue
        if result["state"] == "dismissed" and status == "all":
            continue
        results.append(result)
    return sorted(results, key=lambda item: (-item["fit_score"], item["name"]))[: max(1, min(limit, 50))]


def find_postings(db: Session, student_id: str, query: str = "", status: str = "all", limit: int = 20) -> list[dict]:
    signals = _signals(db, student_id)
    query_tokens = _tokens(query)
    results = []
    today = date.today().isoformat()
    for posting in db.scalars(select(CoopPosting).where(CoopPosting.active.is_(True))).all():
        if posting.closes_at and posting.closes_at < today:
            continue
        result = posting_result(db, student_id, posting, signals)
        if query_tokens and not query_tokens.intersection(_tokens([result["title"], result["company_name"], result["skills"], result["location"]])):
            continue
        if status != "all" and result["state"] != status:
            continue
        if result["state"] == "dismissed" and status == "all":
            continue
        results.append(result)
    freshness_order = {"today": 0, "recent": 1, "older": 2}
    shortlist = sorted(results, key=lambda item: (item["is_demo"], -item["fit_score"], freshness_order[item["freshness"]], item["title"]))[: max(1, min(limit, 50))]
    return rerank(db, shortlist, "coop_rerank", student_id=student_id)


def require_student(db: Session, student_id: str) -> None:
    if db.get(Student, student_id) is None:
        raise HTTPException(404, "Student not found")


@router.get("/api/students/{student_id}/coop/overview")
def overview(student_id: str, _owner: OwnedStudent, db: Db) -> dict:
    require_student(db, student_id)
    companies = find_companies(db, student_id, limit=8)
    postings = find_postings(db, student_id, limit=8)
    saved = db.scalars(select(StudentCoopState).where(StudentCoopState.student_id == student_id, StudentCoopState.status == "saved")).all()
    return {
        "companies": companies, "postings": postings, "saved_count": len(saved),
        "verified_openings": sum(1 for item in postings if item["status"] == "verified_open" and not item["is_demo"]),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/api/students/{student_id}/coop/companies")
def companies(student_id: str, _owner: OwnedStudent, db: Db, query: str = "", status: str = "all", limit: int = Query(20, ge=1, le=50)) -> dict:
    require_student(db, student_id)
    return {"results": find_companies(db, student_id, query, status, limit)}


@router.get("/api/students/{student_id}/coop/postings")
def postings(student_id: str, _owner: OwnedStudent, db: Db, query: str = "", status: str = "all", limit: int = Query(20, ge=1, le=50)) -> dict:
    require_student(db, student_id)
    return {"results": find_postings(db, student_id, query, status, limit)}


@router.get("/api/students/{student_id}/coop/companies/{company_id}")
def company_detail(student_id: str, _owner: OwnedStudent, company_id: str, db: Db) -> dict:
    require_student(db, student_id)
    company = db.get(CoopCompany, company_id)
    if company is None or not company.active:
        raise HTTPException(404, "Company not found")
    return company_result(db, student_id, company)


@router.get("/api/students/{student_id}/coop/postings/{posting_id}")
def posting_detail(student_id: str, _owner: OwnedStudent, posting_id: str, db: Db) -> dict:
    require_student(db, student_id)
    posting = db.get(CoopPosting, posting_id)
    if posting is None or not posting.active:
        raise HTTPException(404, "Posting not found")
    return posting_result(db, student_id, posting)


def _set_state(db: Session, student_id: str, target_type: str, target_id: str, status: str) -> dict:
    if target_type == "company":
        if db.get(CoopCompany, target_id) is None:
            raise HTTPException(404, "Company not found")
    elif db.get(CoopPosting, target_id) is None:
        raise HTTPException(404, "Posting not found")
    item = db.scalar(select(StudentCoopState).where(StudentCoopState.student_id == student_id, StudentCoopState.target_type == target_type, StudentCoopState.target_id == target_id))
    if status == "neutral":
        if item:
            db.delete(item)
    elif item:
        item.status = status
    else:
        db.add(StudentCoopState(student_id=student_id, target_type=target_type, target_id=target_id, status=status))
    db.commit()
    return {"status": status}


@router.post("/api/students/{student_id}/coop/companies/{company_id}/status")
def set_company_state(student_id: str, _owner: OwnedStudent, company_id: str, body: CoopStateInput, db: Db) -> dict:
    require_student(db, student_id)
    return _set_state(db, student_id, "company", company_id, body.status)


@router.post("/api/students/{student_id}/coop/postings/{posting_id}/status")
def set_posting_state(student_id: str, _owner: OwnedStudent, posting_id: str, body: CoopStateInput, db: Db) -> dict:
    require_student(db, student_id)
    return _set_state(db, student_id, "posting", posting_id, body.status)


@router.get("/internal/hermes/students/{student_id}/coop/companies")
def internal_companies(student_id: str, db: Db, grant: ReadGrant, query: str = "", limit: int = Query(5, ge=1, le=8)) -> dict:
    student_id = student_for(db, grant, student_id)
    require_student(db, student_id)
    return {"results": find_companies(db, student_id, query, limit=limit), "provenance": "Waypoint cached co-op catalog"}


@router.get("/internal/hermes/students/{student_id}/coop/postings")
def internal_postings(student_id: str, db: Db, grant: ReadGrant, query: str = "", limit: int = Query(5, ge=1, le=8)) -> dict:
    student_id = student_for(db, grant, student_id)
    require_student(db, student_id)
    return {"results": find_postings(db, student_id, query, limit=limit), "provenance": "Waypoint cached official, Telegram, and LinkedIn sources"}


@router.get("/internal/hermes/students/{student_id}/coop/{target_type}/{target_id}")
def internal_target(student_id: str, target_type: Literal["company", "posting"], target_id: str, db: Db, grant: ReadGrant) -> dict:
    student_id = student_for(db, grant, student_id)
    require_student(db, student_id)
    if target_type == "company":
        company = db.get(CoopCompany, target_id)
        if not company or not company.active:
            raise HTTPException(404, "Company not found")
        return company_result(db, student_id, company)
    posting = db.get(CoopPosting, target_id)
    if not posting or not posting.active:
        raise HTTPException(404, "Posting not found")
    return posting_result(db, student_id, posting)


@router.post("/internal/coop/sync", dependencies=[Depends(require_internal)])
def internal_sync(db: Db, source: Literal["all", "official", "telegram", "linkedin"] = "all") -> dict:
    if source == "all":
        return sync_all_coop_sources(db)
    if source == "official":
        return {"official": sync_official_coop_sources(db)}
    return {source: sync_coop_source(db, source)}
