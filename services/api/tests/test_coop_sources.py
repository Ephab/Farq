import os
import tempfile
import uuid
from pathlib import Path

import httpx
import pytest


TEST_DB = Path(tempfile.gettempdir()) / f"farq-coop-sources-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app.coop import _upsert_candidate, seed_coop_catalog, sync_coop_source  # noqa: E402
from app.coop_sources import CoopCandidate, parse_linkedin_items, parse_telegram_archive  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import CoopPosting, CoopPostingSource, OpportunitySyncRun  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def database():
    Base.metadata.create_all(engine)
    db = SessionLocal()
    seed_coop_catalog(db)
    db.close()
    yield
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def test_parse_arabic_telegram_coop_post():
    html = '''
    <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="nobthacv1/321">
      <div class="tgme_widget_message_text js-message_text" dir="auto">
        التدريب التعاوني<br/>الجهة: شركة مثال<br/>المدينة: الرياض<br/>آخر موعد: 2026-10-15<br/>
        <a href="https://example.sa/apply">رابط التقديم</a>
      </div>
      <a class="tgme_widget_message_date" href="https://t.me/nobthacv1/321"><time datetime="2026-09-27T08:00:00+00:00"></time></a>
    </div>'''
    results = parse_telegram_archive(html)
    assert len(results) == 1
    item = results[0]
    assert item.external_id == "nobthacv1:321"
    assert item.company == "شركة مثال"
    assert item.location == "الرياض"
    assert item.closes_at == "2026-10-15"
    assert item.apply_url == "https://example.sa/apply"


def test_parse_linkedin_items_filters_non_internships_and_keeps_provenance():
    results = parse_linkedin_items([
        {"id": "991", "title": "Software Engineering Intern", "companyName": "Example", "location": "Riyadh", "jobUrl": "https://linkedin.com/jobs/view/991", "postedAt": "2026-09-25T00:00:00Z"},
        {"id": "992", "title": "Senior Accountant", "companyName": "Example", "location": "Riyadh", "jobUrl": "https://linkedin.com/jobs/view/992"},
    ])
    assert [item.external_id for item in results] == ["991"]
    assert results[0].published_at is not None


def test_cross_source_candidates_merge_and_retain_both_sources():
    db = SessionLocal()
    telegram = CoopCandidate(source="telegram", external_id="nobthacv1:500", title="AI Intern", company="Merge Labs", location="Riyadh", apply_url="https://merge.sa/apply", detail_url="https://t.me/nobthacv1/500")
    linkedin = CoopCandidate(source="linkedin", external_id="500", title="AI Intern", company="Merge Labs", location="Riyadh", apply_url="https://merge.sa/apply", detail_url="https://linkedin.com/jobs/view/500")
    first, posting = _upsert_candidate(db, telegram)
    second, merged = _upsert_candidate(db, linkedin)
    db.commit()
    assert first == "inserted"
    assert second == "merged"
    assert posting.id == merged.id
    sources = db.query(CoopPostingSource).filter_by(posting_id=posting.id).all()
    assert {item.source for item in sources} == {"telegram", "linkedin"}
    db.close()


def test_failed_source_sync_records_failure_and_keeps_cached_posting():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    db = SessionLocal()
    before = db.query(CoopPosting).count()
    result = sync_coop_source(db, "telegram", httpx.Client(transport=httpx.MockTransport(handler)))
    assert result["status"] == "failed"
    assert db.query(CoopPosting).count() == before
    run = db.query(OpportunitySyncRun).filter_by(source="coop:telegram").order_by(OpportunitySyncRun.started_at.desc()).first()
    assert run.status == "failed"
    db.close()
