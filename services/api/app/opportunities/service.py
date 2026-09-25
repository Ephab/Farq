from __future__ import annotations

import json
import re
import threading
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Opportunity, OpportunitySyncRun, RoadmapVersion, Student, StudentFact, StudentOpportunity, StudentProfile, now
from ..schemas import ChatMessageUi, RoadmapOperation, RoadmapOpportunity, RoadmapResource
from .base import OpportunityConnector
from .hackathonat import HackathonatConnector

HACKATHONAT_SOURCE = "hackathonat"
RECOMMENDATION_THRESHOLD = 60
STALE_AFTER = timedelta(hours=12)
_sync_lock = threading.Lock()
TOKEN = re.compile(r"[A-Za-z0-9+#.]+|[\u0600-\u06ff]+")
ALIASES = {
    "ai": {"ai", "artificial", "intelligence", "ذكاء", "الذكاء", "اصطناعي", "الاصطناعي"},
    "cybersecurity": {"cyber", "cybersecurity", "security", "امن", "الأمن", "سيبراني", "السيبراني"},
    "data": {"data", "analytics", "analysis", "بيانات", "البيانات", "تحليل"},
    "programming": {"programming", "software", "code", "برمجة", "البرمجة", "تطوير", "التطبيقات"},
    "startup": {"startup", "entrepreneurship", "ريادة", "رواد", "ابتكار", "الابتكار"},
    "design": {"design", "ux", "ui", "تصميم", "التصميم"},
    "research": {"research", "paper", "publication", "بحث", "البحث", "ابحاث", "أبحاث"},
}


def _tokens(value: object) -> set[str]:
    raw = " ".join(str(item) for item in value) if isinstance(value, (list, tuple, set)) else str(value or "")
    found = {item.lower() for item in TOKEN.findall(raw)}
    expanded = set(found)
    for canonical, words in ALIASES.items():
        if found.intersection(words):
            expanded.add(canonical)
    return expanded


def sync_hackathonat(db: Session, connector: OpportunityConnector | None = None) -> dict:
    if not _sync_lock.acquire(blocking=False):
        return {"status": "running", "fetched": 0, "changed": 0, "run_id": None}
    connector = connector or HackathonatConnector()
    run = OpportunitySyncRun(source=connector.source)
    db.add(run)
    db.commit()
    try:
        records = connector.fetch()
        seen: set[str] = set()
        changed = 0
        stamp = now()
        existing = {item.external_id: item for item in db.scalars(select(Opportunity).where(Opportunity.source == connector.source)).all()}
        for record in records:
            seen.add(record.external_id)
            item = existing.get(record.external_id)
            if item is None:
                item = Opportunity(source=connector.source, external_id=record.external_id, title=record.title, raw_hash=record.raw_hash)
                db.add(item)
                existing[record.external_id] = item
                changed += 1
            elif item.raw_hash != record.raw_hash or not item.active:
                changed += 1
            item.title = record.title
            item.organizer = record.organizer
            item.locations_json = json.dumps(record.locations, ensure_ascii=False)
            item.topics_json = json.dumps(record.topics, ensure_ascii=False)
            item.virtual = record.virtual
            item.source_date = record.source_date
            item.detail_url = record.detail_url
            item.registration_url = record.registration_url
            item.active = record.active
            item.hidden = record.hidden
            item.raw_hash = record.raw_hash
            item.last_seen_at = stamp
            item.fetched_at = stamp
        for external_id, item in existing.items():
            if external_id not in seen and item.active:
                item.active = False
                changed += 1
        db.flush()
        for student_id in db.scalars(select(Student.id)).all():
            recompute_student(db, student_id)
        run.status = "completed"
        run.fetched_count = len(records)
        run.changed_count = changed
        run.finished_at = now()
        db.commit()
        return {"status": run.status, "fetched": len(records), "changed": changed, "run_id": run.id}
    except Exception as exc:
        db.rollback()
        run = db.get(OpportunitySyncRun, run.id)
        run.status = "failed"
        run.error = str(exc)[:2000]
        run.finished_at = now()
        db.commit()
        raise
    finally:
        _sync_lock.release()


def _student_signals(db: Session, student_id: str) -> tuple[set[str], set[str], set[str], set[str]]:
    profile = db.get(StudentProfile, student_id)
    facts = db.scalars(select(StudentFact).where(StudentFact.student_id == student_id, StudentFact.active.is_(True))).all()
    interests = _tokens([profile.program if profile else "", profile.discipline if profile else ""])
    goals: set[str] = set()
    preferences: set[str] = set()
    for fact in facts:
        try:
            value = json.loads(fact.value_json)
        except json.JSONDecodeError:
            value = fact.value_json
        tokens = _tokens([fact.key, value])
        if fact.category in {"interest", "skill", "strength", "course"}:
            interests.update(tokens)
        elif fact.category == "goal":
            goals.update(tokens)
        elif fact.category == "preference":
            preferences.update(tokens)
    roadmap_tokens: set[str] = set()
    current = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    if current:
        try:
            for node in json.loads(current.snapshot_json).get("nodes", []):
                roadmap_tokens.update(_tokens([node.get("title"), node.get("tagline"), node.get("subtopics", [])]))
        except (json.JSONDecodeError, AttributeError):
            pass
    return interests, roadmap_tokens, goals, preferences


def _score(item: Opportunity, signals: tuple[set[str], set[str], set[str], set[str]]) -> tuple[float, list[str]]:
    interests, roadmap, goals, preferences = signals
    tokens = _tokens([item.title, item.organizer, json.loads(item.topics_json), json.loads(item.locations_json)])
    reasons: list[str] = []
    score = 0.0
    if tokens.intersection(interests):
        score += 35
        reasons.append("Matches your stated interests")
    if tokens.intersection(roadmap):
        score += 25
        reasons.append("Connects to skills on your roadmap")
    if tokens.intersection(goals):
        score += 15
        reasons.append("Supports your stated direction")
    if tokens.intersection(preferences):
        score += 15
        reasons.append("Matches your participation preferences")
    elif not preferences:
        score += 8
    if item.source_date:
        score += 10
        reasons.append("Has a current source-provided date")
    if not tokens.intersection(interests) and tokens.intersection(roadmap):
        score += 10
    return min(score, 100), reasons[:3] or ["A current Saudi technology opportunity"]


def recompute_student(db: Session, student_id: str) -> None:
    signals = _student_signals(db, student_id)
    today = date.today().isoformat()
    items = db.scalars(select(Opportunity).where(Opportunity.source == HACKATHONAT_SOURCE, Opportunity.active.is_(True), Opportunity.hidden.is_(False))).all()
    existing = {item.opportunity_id: item for item in db.scalars(select(StudentOpportunity).where(StudentOpportunity.student_id == student_id)).all()}
    eligible: set[str] = set()
    for opportunity in items:
        if opportunity.source_date and opportunity.source_date < today:
            continue
        score, reasons = _score(opportunity, signals)
        if score < RECOMMENDATION_THRESHOLD:
            continue
        eligible.add(opportunity.id)
        recommendation = existing.get(opportunity.id)
        if recommendation is None:
            recommendation = StudentOpportunity(student_id=student_id, opportunity_id=opportunity.id)
            db.add(recommendation)
        recommendation.score = score
        recommendation.reasons_json = json.dumps(reasons)
    for opportunity_id, recommendation in existing.items():
        if opportunity_id not in eligible and recommendation.status == "unseen":
            recommendation.status = "seen"
            recommendation.seen_at = now()


def _last_sync(db: Session) -> OpportunitySyncRun | None:
    return db.scalar(select(OpportunitySyncRun).where(OpportunitySyncRun.source == HACKATHONAT_SOURCE, OpportunitySyncRun.status == "completed").order_by(OpportunitySyncRun.finished_at.desc()))


def _as_aware(value: datetime | None) -> datetime | None:
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def opportunity_summary(db: Session, student_id: str) -> dict:
    last = _last_sync(db)
    unseen = db.scalar(select(func.count()).select_from(StudentOpportunity).where(StudentOpportunity.student_id == student_id, StudentOpportunity.status == "unseen")) or 0
    finished = _as_aware(last.finished_at if last else None)
    stale = finished is None or datetime.now(timezone.utc) - finished > STALE_AFTER
    return {"source": HACKATHONAT_SOURCE, "unseen_count": unseen, "last_synced_at": finished.isoformat() if finished else None, "stale": stale, "status": "unavailable" if last is None else "stale" if stale else "ready"}


def _result(rec: StudentOpportunity, opp: Opportunity) -> dict:
    return {
        "id": opp.id, "external_id": opp.external_id, "title": opp.title, "organizer": opp.organizer,
        "locations": json.loads(opp.locations_json), "topics": json.loads(opp.topics_json), "virtual": opp.virtual,
        "source_date": opp.source_date, "date_label": "Date shown by Hackathonat" if opp.source_date else None,
        "detail_url": opp.detail_url, "registration_url": opp.registration_url, "source": opp.source,
        "fetched_at": opp.fetched_at.isoformat(), "score": round(rec.score), "reasons": json.loads(rec.reasons_json), "status": rec.status,
    }


def find_hackathons(db: Session, student_id: str, query: str = "", limit: int = 5) -> dict:
    query_tokens = _tokens(query)
    rows = db.execute(select(StudentOpportunity, Opportunity).join(Opportunity, StudentOpportunity.opportunity_id == Opportunity.id).where(StudentOpportunity.student_id == student_id, StudentOpportunity.status != "dismissed", Opportunity.active.is_(True), Opportunity.hidden.is_(False)).order_by(StudentOpportunity.score.desc(), Opportunity.source_date, Opportunity.title)).all()
    results = []
    today = date.today().isoformat()
    for rec, opp in rows:
        if opp.source_date and opp.source_date < today:
            continue
        if query_tokens and not query_tokens.intersection(_tokens([opp.title, opp.organizer, json.loads(opp.topics_json)])):
            continue
        results.append(_result(rec, opp))
        if len(results) >= max(1, min(limit, 5)):
            break
    return {**opportunity_summary(db, student_id), "results": results}


def mark_seen(db: Session, student_id: str, ids: list[str]) -> int:
    rows = db.scalars(select(StudentOpportunity).where(StudentOpportunity.student_id == student_id, StudentOpportunity.opportunity_id.in_(ids))).all()
    changed = 0
    for item in rows:
        if item.status == "unseen":
            item.status = "seen"
            item.seen_at = now()
            changed += 1
    db.commit()
    return changed


def enrich_chat_ui(db: Session, student_id: str, ui: ChatMessageUi) -> ChatMessageUi:
    """Replace any model-supplied opportunity display data with cached truth."""
    if ui.choice_group is None:
        return ui
    for option in ui.choice_group.options:
        option.opportunity = None
        if not option.opportunity_id:
            continue
        row = db.execute(
            select(StudentOpportunity, Opportunity)
            .join(Opportunity, StudentOpportunity.opportunity_id == Opportunity.id)
            .where(
                StudentOpportunity.student_id == student_id,
                Opportunity.id == option.opportunity_id,
                Opportunity.active.is_(True),
                Opportunity.hidden.is_(False),
            )
        ).first()
        if row:
            option.opportunity = _result(row[0], row[1])
        else:
            option.opportunity_id = None
    return ui


def normalize_opportunity_operations(db: Session, student_id: str, operations: list[RoadmapOperation]) -> list[RoadmapOperation]:
    """Validate opportunity nodes and replace their source metadata with cached truth."""
    for operation in operations:
        node = operation.node
        if operation.type != "add_node" or node is None or node.nodeType != "opportunity":
            continue
        opportunity_id = node.opportunity.opportunity_id if node.opportunity else ""
        row = db.execute(
            select(StudentOpportunity, Opportunity)
            .join(Opportunity, StudentOpportunity.opportunity_id == Opportunity.id)
            .where(
                StudentOpportunity.student_id == student_id,
                Opportunity.id == opportunity_id,
                Opportunity.active.is_(True),
                Opportunity.hidden.is_(False),
            )
        ).first()
        if not row:
            raise ValueError("Opportunity node does not reference a current recommendation")
        opportunity = row[1]
        node.opportunity = RoadmapOpportunity(
            opportunity_id=opportunity.id,
            external_id=opportunity.external_id,
            source=opportunity.source,
            detail_url=opportunity.detail_url,
            registration_url=opportunity.registration_url,
            source_date=opportunity.source_date,
            date_label="Date shown by Hackathonat" if opportunity.source_date else None,
            locations=json.loads(opportunity.locations_json),
            virtual=opportunity.virtual,
            fetched_at=opportunity.fetched_at.isoformat(),
        )
        node.resources = [resource for resource in node.resources if resource.url not in {opportunity.detail_url, opportunity.registration_url}]
        if opportunity.registration_url:
            node.resources.insert(0, RoadmapResource(label="Register on the official event page", url=opportunity.registration_url))
        if opportunity.detail_url:
            node.resources.append(RoadmapResource(label="View on Hackathonat", url=opportunity.detail_url))
    return operations
