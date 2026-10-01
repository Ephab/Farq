import os
import tempfile
import time
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / f"waypoint-coop-refresh-{uuid.uuid4()}.db"
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"

from app import coop_refresh  # noqa: E402
from app.coop import sync_feed_sources  # noqa: E402
from app.coop_sources import FEEDS, parse_feed_items  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CoopPosting, OpportunitySyncRun, now  # noqa: E402

EMPTY = "<?xml version='1.0'?><rss version='2.0'><channel><title>x</title><item><title>No jobs currently available</title><link>https://careers.stc.com.sa</link><guid isPermaLink='false'>0</guid></item></channel></rss>"


def rss(*jobs: tuple[str, str, str]) -> str:
    items = "".join(
        f"<item><title><![CDATA[{title}]]></title><description><![CDATA[<p>Python and data.</p><p>Deadline: 2099-01-31</p>]]></description>"
        f"<pubDate>Mon, 28 Sep 2026 0:00:00 GMT</pubDate><link>https://careers.stc.com.sa/job/{slug}/{jid}/?utm_source=J2WRSS</link><guid>{jid}</guid></item>"
        for title, slug, jid in jobs
    )
    return f"<?xml version='1.0'?><rss version='2.0'><channel><title>x</title>{items}</channel></rss>"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client
    engine.dispose()
    TEST_DB.unlink(missing_ok=True)


def feed_client(bodies: dict[str, str | int]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        body = bodies.get(request.url.host, EMPTY)
        return httpx.Response(body, text="") if isinstance(body, int) else httpx.Response(200, text=body)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_feed_parser_skips_placeholder_and_filters_site_wide_feeds():
    stc = next(feed for feed in FEEDS if feed["slug"] == "stc")
    assert parse_feed_items(EMPTY, stc) == []
    items = parse_feed_items(rss(("Software Engineering Co-op", "Coop-SWE", "857394923")), stc)
    assert len(items) == 1
    item = items[0]
    assert item.external_id == "stc:857394923" and item.closes_at == "2099-01-31"
    assert item.detail_url == "https://careers.stc.com.sa/job/Coop-SWE/857394923/"  # tracking query dropped
    assert item.source_status == "verified_open"
    kaust = {**stc, "mode": "filter"}
    mixed = rss(("Senior HPC Administrator", "hpc", "1111111"), ("Summer Internship Programme", "intern", "2222222"))
    assert [i.title for i in parse_feed_items(mixed, kaust)] == ["Summer Internship Programme"]
    with pytest.raises(Exception):
        parse_feed_items("<rss><channel>", stc)


def test_feed_sync_inserts_then_retires_a_posting_the_employer_removed(client: TestClient):
    db = SessionLocal()
    first = sync_feed_sources(db, feed_client({"careers.stc.com.sa": rss(("Data Co-op", "data-coop", "857400001"))}))
    assert first["status"] == "completed" and first["inserted"] == 1
    posting = db.query(CoopPosting).filter_by(source="official_feed").one()
    assert posting.status == "verified_open" and posting.active and posting.company_slug == "stc"
    # A second fetch that no longer lists it, from a feed that answered fine, means it was taken down.
    second = sync_feed_sources(db, feed_client({}))
    assert second["retired"] == 1
    db.refresh(posting)
    assert posting.active is False and posting.status == "closed"
    db.close()


def test_failed_feed_never_retires_postings_and_is_reported(client: TestClient):
    db = SessionLocal()
    sync_feed_sources(db, feed_client({"careers.stc.com.sa": rss(("Network Co-op", "net-coop", "857400002"))}))
    result = sync_feed_sources(db, feed_client({"careers.stc.com.sa": 500}))
    assert result["status"] == "partial" and result["retired"] == 0
    assert result["feeds"]["stc"]["ok"] is False
    assert db.query(CoopPosting).filter_by(source="official_feed", external_id="stc:857400002").one().active
    db.close()


def test_new_since_last_visit_and_deadline(client: TestClient):
    db = SessionLocal()
    sync_feed_sources(db, feed_client({"careers.stc.com.sa": rss(("Security Co-op", "sec-coop", "857400003"))}))
    db.close()
    # First ever visit: nothing is flagged new, but the visit is recorded.
    first = client.get("/api/students/demo-student/coop/overview").json()
    assert first["new_count"] == 0 and first["last_visit_at"] is None
    assert client.post("/api/students/demo-student/coop/visit").status_code == 200
    time.sleep(0.05)
    db = SessionLocal()
    sync_feed_sources(db, feed_client({"careers.stc.com.sa": rss(("Security Co-op", "sec-coop", "857400003"), ("Cloud Co-op", "cloud-coop", "857400004"))}))
    db.close()
    after = client.get("/api/students/demo-student/coop/overview").json()
    assert after["new_count"] == 1
    posts = client.get("/api/students/demo-student/coop/postings?limit=50").json()["results"]
    fresh = {p["title"]: p for p in posts}
    assert fresh["Cloud Co-op"]["is_new"] is True and fresh["Security Co-op"]["is_new"] is False
    assert fresh["Cloud Co-op"]["closes_at"] == "2099-01-31" and fresh["Cloud Co-op"]["days_left"] > 1000


def test_expired_postings_are_dropped(client: TestClient):
    db = SessionLocal()
    sync_feed_sources(db, feed_client({"careers.stc.com.sa": rss(("Old Co-op", "old-coop", "857400005"))}))
    row = db.query(CoopPosting).filter_by(external_id="stc:857400005").one()
    row.closes_at = "2020-01-01"
    db.commit()
    db.close()
    titles = [p["title"] for p in client.get("/api/students/demo-student/coop/postings?limit=50").json()["results"]]
    assert "Old Co-op" not in titles
    db = SessionLocal()
    from app.coop import expire_closed_postings
    assert expire_closed_postings(db) >= 1
    assert db.query(CoopPosting).filter_by(external_id="stc:857400005").one().active is False
    db.close()


def test_sources_report_not_configured_and_never_run(client: TestClient, monkeypatch):
    monkeypatch.delenv("APIFY_API_KEY", raising=False)
    body = client.get("/api/students/demo-student/coop/sources").json()
    rows = {row["key"]: row for row in body["sources"]}
    assert rows["linkedin"]["status"] == "not_configured" and rows["linkedin"]["hint"] == "APIFY_API_KEY"
    assert rows["feeds"]["status"] in {"ok", "partial"}  # fed by the tests above
    assert body["last_updated_at"]


def test_manual_refresh_runs_in_background_and_is_rate_limited(client: TestClient, monkeypatch):
    calls: list[str] = []

    def fake(key):
        def run(db):
            calls.append(key)
            db.add(OpportunitySyncRun(source=f"coop:{key}", status="completed", fetched_count=3, changed_count=1, finished_at=now()))
            db.commit()
            return {"status": "completed", "fetched": 3, "changed": 1}
        return run

    for key in coop_refresh.SOURCES:
        monkeypatch.setitem(coop_refresh.SOURCES[key], "run", fake(key))
    monkeypatch.setitem(coop_refresh.SOURCES["linkedin"], "enabled", lambda: False)
    monkeypatch.setattr(coop_refresh, "_last_manual", 0.0)
    first = client.post("/api/students/demo-student/coop/refresh")
    assert first.status_code == 202 and first.json()["started"] is True
    for _ in range(100):
        state = client.get("/api/students/demo-student/coop/sources").json()
        if state["refresh"]["status"] == "done":
            break
        time.sleep(0.05)
    assert state["refresh"]["status"] == "done"
    assert sorted(calls) == ["feeds", "official", "telegram"]  # linkedin is not configured
    assert all(item["status"] == "ok" for item in state["refresh"]["sources"].values())
    again = client.post("/api/students/demo-student/coop/refresh")
    assert again.status_code == 429 and int(again.headers["Retry-After"]) > 0


def test_refresh_is_owner_only(client: TestClient):
    other = client.post("/api/students", json={"display_name": "Intruder"}).json()["student_id"]
    response = client.post("/api/students/demo-student/coop/refresh", headers={"X-Waypoint-User": other, "x-test-no-auto": "1"})
    assert response.status_code in {401, 403, 404}


def test_scheduler_picks_sources_whose_interval_has_passed(client: TestClient, monkeypatch):
    monkeypatch.delenv("APIFY_API_KEY", raising=False)
    db = SessionLocal()
    db.query(OpportunitySyncRun).delete()
    db.commit()
    assert set(coop_refresh.due_keys(db)) == {"feeds", "telegram", "official"}  # never run: all due, linkedin unconfigured
    db.add(OpportunitySyncRun(source="coop:feeds", status="completed", finished_at=now()))
    db.add(OpportunitySyncRun(source="coop:telegram", status="failed", error="boom", started_at=now(), finished_at=now()))
    db.commit()
    assert set(coop_refresh.due_keys(db)) == {"official"}  # fresh feeds and a just-failed source wait for their retry window
    db.close()
