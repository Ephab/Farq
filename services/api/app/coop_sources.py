"""Bounded public-source adapters for Saudi co-op opportunities."""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from xml.etree import ElementTree
from urllib.parse import quote, urlparse

import httpx


TELEGRAM_ARCHIVE_URL = os.getenv("COOP_TELEGRAM_ARCHIVE_URL", "https://t.me/s/nobthacv1")
LINKEDIN_ACTOR_ID = os.getenv("APIFY_LINKEDIN_ACTOR_ID", "hKByXkMQaC5Qt9UMN")
MAX_RESPONSE_BYTES = 2_000_000
# Whole words for the Latin terms ("intern" must not match "international" or "internal");
# Arabic phrases are matched as phrases.
COOP_PATTERN = re.compile(
    r"\b(?:co-?op|cooperative training|intern|interns|internships?)\b|تدريب تعاوني|التدريب التعاوني|تمهير",
    re.IGNORECASE,
)
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def is_coop_text(text: str) -> bool:
    return bool(COOP_PATTERN.search(text or ""))
SKILL_TERMS = {
    "software engineering": ("software", "developer", "programming", "برمجة", "تطوير البرمجيات"),
    "ai": ("artificial intelligence", "machine learning", "deep learning", "ذكاء اصطناعي", "تعلم الآلة"),
    "data": ("data", "analytics", "بيانات", "تحليل البيانات"),
    "cybersecurity": ("cyber", "security", "أمن سيبراني", "الأمن السيبراني"),
    "cloud": ("cloud", "devops", "سحابة", "حوسبة سحابية"),
    "engineering": ("engineering", "engineer", "هندسة", "مهندس"),
    "design": ("design", "ux", "ui", "تصميم"),
    "business": ("business", "finance", "marketing", "أعمال", "مالية", "تسويق"),
}


@dataclass
class CoopCandidate:
    source: str
    external_id: str
    title: str
    company: str
    location: str = ""
    description: str = ""
    skills: list[str] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)
    detail_url: str = ""
    apply_url: str = ""
    opens_at: str | None = None
    closes_at: str | None = None
    published_at: datetime | None = None
    source_status: str = "listed"
    metadata: dict = field(default_factory=dict)

    @property
    def raw_hash(self) -> str:
        body = json.dumps({"title": self.title, "company": self.company, "description": self.description, "apply": self.apply_url}, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(body.encode()).hexdigest()


def _clean(value: object) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value or ""))).strip()


def _iso_datetime(value: object) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _first_url(urls: list[str], *, exclude: tuple[str, ...] = ()) -> str:
    for value in urls:
        parsed = urlparse(value)
        if parsed.scheme in {"http", "https"} and not any(host in (parsed.hostname or "") for host in exclude):
            return value
    return ""


def _label(text: str, labels: tuple[str, ...], extra_words: int = 0) -> str:
    """Value after "Label:" on its own line. With extra_words, up to that many words may sit
    between the label and the separator ("آخر موعد للتقديم: …")."""
    gap = rf"(?:\s+\S+){{0,{extra_words}}}" if extra_words else ""
    for label in labels:
        match = re.search(rf"(?:^|\n)\s*{re.escape(label)}{gap}\s*[:：-]\s*([^\n]+)", text, re.IGNORECASE)
        if match:
            return _clean(match.group(1))[:300]
    return ""


def _valid_date(year: int, month: int, day: int) -> str | None:
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _deadline(text: str) -> str | None:
    """An explicit deadline as YYYY-MM-DD, or None. Impossible dates (month 15) are rejected
    rather than stored, since they would sort after every real date and never expire."""
    line = _label(text.translate(ARABIC_DIGITS), ("deadline", "last date", "آخر موعد", "موعد التقديم", "ينتهي", "ينتهي التقديم"), extra_words=3)
    if not line:
        return None
    match = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", line)
    if match:
        return _valid_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    match = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})", line)
    if match:
        first, second, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        # Saudi postings write day/month; fall back to month/day only when that is the only valid reading.
        return _valid_date(year, second, first) or _valid_date(year, first, second)
    return None


def _infer_company(text: str) -> str:
    lines = [_clean(line).strip("|—- ") for line in text.splitlines()]
    # A bare "Label:" line ("المسمى:") names a field whose value is on the next line, never the employer.
    lines = [line for line in lines if line and not line.startswith("#") and not re.fullmatch(r"[^\w\u0600-\u06ff]+", line) and not re.search(r"[:：]$", line)]
    for line in lines:
        match = re.search(r"(?:^|\s)(شركة|مؤسسة|جامعة|هيئة)\s+(.{2,120}?)(?=\s+(?:تعلن|فاتحة|توفر)|$)", line)
        if match:
            return _clean(f"{match.group(1)} {match.group(2)}")
    for index, line in enumerate(lines):
        if re.search(r"\b(?:تعلن|يعلن)\b", line) and index:
            previous = lines[index - 1]
            if 2 <= len(previous) <= 180 and not any(word in previous for word in ("فرصة", "تدريب", "برنامج")):
                return previous
    ignored = ("من الخاص", "التدريب", "فرصة", "السلام عليكم", "البرنامج", "تنبيه")
    for line in lines:
        if len(line) <= 180 and not any(value in line.lower() for value in ignored):
            return line
    return "Saudi co-op employer"


def _infer_location(text: str) -> str:
    locations = {
        "الرياض": "Riyadh", "جدة": "Jeddah", "الدمام": "Dammam", "الخبر": "Khobar",
        "الظهران": "Dhahran", "مكة": "Makkah", "المدينة": "Madinah", "حائل": "Ha'il",
    }
    for needle, label in locations.items():
        if needle in text:
            return label
    return ""


def _infer_skills(text: str) -> list[str]:
    lowered = text.lower()
    return [skill for skill, needles in SKILL_TERMS.items() if any(needle in lowered for needle in needles)]


class _TelegramParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.posts: list[dict] = []
        self.current: dict | None = None
        self.capture_text = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if tag == "div" and "tgme_widget_message" in classes and values.get("data-post"):
            self.current = {"post": values["data-post"], "text": [], "links": [], "published": None}
        elif self.current and tag == "div" and "tgme_widget_message_text" in classes:
            self.capture_text = True
        elif self.current and tag == "a" and values.get("href"):
            self.current["links"].append(values["href"])
        elif self.current and tag == "time" and values.get("datetime"):
            self.current["published"] = values["datetime"]
        elif self.current and self.capture_text and tag in {"br", "p", "li"}:
            self.current["text"].append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self.current and tag == "div" and self.capture_text:
            self.capture_text = False
        elif self.current and tag == "div" and not self.capture_text:
            # Telegram message wrappers close after their inner content. A new wrapper also
            # flushes the prior record; final flushing is handled by parse_telegram_archive.
            pass

    def handle_data(self, data: str) -> None:
        if self.current and self.capture_text:
            self.current["text"].append(data)


def parse_telegram_archive(body: str, archive_url: str = TELEGRAM_ARCHIVE_URL) -> list[CoopCandidate]:
    # Splitting on message wrappers prevents HTMLParser's nested divs from needing a depth stack.
    chunks = re.split(r'(?=<div class="tgme_widget_message[^\"]*"[^>]*data-post=")', body)
    results: list[CoopCandidate] = []
    for chunk in chunks[1:]:
        parser = _TelegramParser()
        parser.feed(chunk)
        item = parser.current
        if not item:
            continue
        raw_text = "\n".join(item["text"])
        text = "\n".join(part for part in (_clean(line) for line in raw_text.splitlines()) if part)
        if not text or not is_coop_text(text):
            continue
        channel_post = str(item["post"])
        message_id = channel_post.rsplit("/", 1)[-1]
        company = _label(text, ("company", "organization", "الشركة", "الجهة", "جهة التدريب"))
        title = _label(text, ("position", "role", "opportunity", "المسمى", "الفرصة", "البرنامج"))
        if not company:
            company = _infer_company(text)
        if not title:
            title = f"{company} Cooperative Training"
        location = _label(text, ("location", "city", "الموقع", "المدينة")) or _infer_location(text)
        links = list(dict.fromkeys(item["links"]))
        detail_url = f"https://t.me/{channel_post}"
        apply_url = _first_url(links, exclude=("t.me", "telegram.me"))
        results.append(CoopCandidate(
            source="telegram", external_id=f"nobthacv1:{message_id}", title=title, company=company,
            location=location, description=text[:6000], skills=_infer_skills(text), detail_url=detail_url, apply_url=apply_url,
            closes_at=_deadline(text), published_at=_iso_datetime(item["published"]),
            metadata={"channel": "nobthacv1", "message_id": message_id},
        ))
    return results


def fetch_telegram_candidates(client: httpx.Client | None = None, archive_url: str = TELEGRAM_ARCHIVE_URL, pages: int = 1) -> list[CoopCandidate]:
    owned = client is None
    session = client or httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": "Waypoint/0.1 co-op discovery"})
    try:
        results: dict[str, CoopCandidate] = {}
        next_url = archive_url
        for _ in range(max(1, min(pages, 3))):
            response = session.get(next_url)
            response.raise_for_status()
            if response.url.host not in {"t.me", "telegram.me"} or len(response.content) > MAX_RESPONSE_BYTES:
                raise ValueError("invalid Telegram archive response")
            batch = parse_telegram_archive(response.text, archive_url)
            results.update({item.external_id: item for item in batch})
            # Page by every message on the page, not only co-op ones: a page of unrelated posts
            # must not end the walk, and the oldest message decides where the next page starts.
            ids = [int(value) for value in re.findall(r'data-post="[^"]*/(\d+)"', response.text)]
            if not ids:
                break
            separator = "&" if "?" in archive_url else "?"
            next_url = f"{archive_url}{separator}before={min(ids)}"
        return list(results.values())
    finally:
        if owned:
            session.close()


def parse_linkedin_items(items: list[dict]) -> list[CoopCandidate]:
    results: list[CoopCandidate] = []
    for item in items:
        title = _clean(item.get("title") or item.get("jobTitle"))
        company = _clean(item.get("companyName") or item.get("company"))
        if not title or not company:
            continue
        searchable = f"{title} {_clean(item.get('description'))}".lower()
        if not is_coop_text(searchable):
            continue
        job_url = _clean(item.get("jobUrl") or item.get("link") or item.get("url"))
        external_id = _clean(item.get("id") or item.get("jobId") or item.get("linkedinJobId"))
        if not external_id:
            match = re.search(r"/(?:jobs/view/)?(\d{6,})", job_url)
            external_id = match.group(1) if match else hashlib.sha256(job_url.encode()).hexdigest()[:24]
        apply_url = _clean(item.get("applyUrl") or item.get("externalApplyUrl"))
        results.append(CoopCandidate(
            source="linkedin", external_id=external_id, title=title, company=company,
            location=_clean(item.get("location")), description=_clean(item.get("description"))[:10000],
            skills=_infer_skills(searchable),
            detail_url=job_url, apply_url=apply_url, published_at=_iso_datetime(item.get("postedAt") or item.get("publishedAt")),
            metadata={"employment_type": _clean(item.get("employmentType")), "actor": LINKEDIN_ACTOR_ID},
        ))
    return results


def fetch_linkedin_candidates(client: httpx.Client | None = None) -> list[CoopCandidate]:
    token = os.getenv("APIFY_API_KEY", "").strip()
    if not token:
        return []
    owned = client is None
    session = client or httpx.Client(timeout=75, follow_redirects=True, headers={"Authorization": f"Bearer {token}"})
    actor = quote(LINKEDIN_ACTOR_ID, safe="")
    payload = {
        "keywords": "cooperative training internship software engineering artificial intelligence data cybersecurity engineering",
        "location": "Saudi Arabia", "datePosted": "past month", "maxItems": 25, "scrapeCompany": False,
    }
    try:
        charge_cap = os.getenv("APIFY_MAX_TOTAL_CHARGE_USD", "0.06")
        run = session.post(f"https://api.apify.com/v2/acts/{actor}/runs?waitForFinish=60&maxTotalChargeUsd={charge_cap}", json=payload)
        run.raise_for_status()
        data = run.json().get("data", {})
        if data.get("status") != "SUCCEEDED" or not data.get("defaultDatasetId"):
            raise RuntimeError(f"Apify run did not succeed: {data.get('status', 'unknown')}")
        response = session.get(f"https://api.apify.com/v2/datasets/{data['defaultDatasetId']}/items?clean=true&format=json")
        response.raise_for_status()
        items = response.json()
        if not isinstance(items, list):
            raise ValueError("Apify dataset was not a list")
        return parse_linkedin_items(items)
    finally:
        if owned:
            session.close()


# Public SAP SuccessFactors career-site RSS feeds. They need no key and list only what the
# employer has open right now; an empty feed is a real "nothing open" answer. "category" feeds
# are the employer's own co-op category (every item is a co-op); "filter" feeds are the whole
# site, so only items whose title says co-op/intern are kept.
FEEDS = [
    {"slug": "tahakom", "name": "Tahakom", "mode": "category", "location": "Riyadh",
     "url": "https://careers.tahakom.com/services/rss/category/?catid=4388723"},
    {"slug": "stc", "name": "stc", "mode": "category", "location": "Riyadh",
     "url": "https://careers.stc.com.sa/services/rss/category/?catid=7736023"},
    {"slug": "kaust", "name": "KAUST", "mode": "filter", "location": "Thuwal",
     "url": "https://careers.kaust.edu.sa/services/rss/job/?locale=en_US"},
]
FEED_SOURCE = "official_feed"
FEED_USER_AGENT = "Waypoint/0.1 (student co-op discovery; polite public-feed reader)"
MAX_FEED_ITEMS = 50


def _html_text(value: str) -> str:
    text = re.sub(r"(?i)<\s*(?:br|/p|/div|/li|/h\d)[^>]*>", "\n", value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return "\n".join(part for part in (_clean(line) for line in html.unescape(text).splitlines()) if part)


def parse_feed_items(body: str | bytes, feed: dict) -> list[CoopCandidate]:
    """Normalize one career-site RSS feed. Raises on malformed XML so a broken feed is reported
    as a failure instead of silently reading as "nothing open"."""
    root = ElementTree.fromstring(body)
    results: list[CoopCandidate] = []
    for item in root.iter("item"):
        guid = _clean(item.findtext("guid"))
        link = _clean(item.findtext("link"))
        title = _clean(item.findtext("title"))
        # SuccessFactors pads an empty feed with a "No jobs currently available" placeholder (guid 0).
        match = re.search(r"/job/[^/]+/(\d{5,})", link)
        if not title or guid == "0" or not match:
            continue
        if feed["mode"] == "filter" and not is_coop_text(title):
            continue
        description = _html_text(item.findtext("description") or "")[:8000]
        parsed = urlparse(link)
        clean_link = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        published = None
        try:
            published = parsedate_to_datetime(item.findtext("pubDate") or "")
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError):
            pass
        results.append(CoopCandidate(
            source=FEED_SOURCE, external_id=f"{feed['slug']}:{match.group(1)}", title=title[:300],
            company=feed["name"], location=feed.get("location", ""), description=description,
            skills=_infer_skills(f"{title} {description}"), detail_url=clean_link, apply_url=clean_link,
            closes_at=_deadline(description), published_at=published, source_status="verified_open",
            metadata={"feed": feed["slug"]},
        ))
        if len(results) >= MAX_FEED_ITEMS:
            break
    return results


def fetch_feed_candidates(client: httpx.Client | None = None, feeds: list[dict] | None = None) -> tuple[list[CoopCandidate], dict[str, dict]]:
    """Fetch every feed with a hard timeout and size cap. Returns the candidates plus a per-feed
    outcome; one failing feed never hides the others."""
    owned = client is None
    session = client or httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": FEED_USER_AGENT, "Accept": "application/rss+xml, application/xml"})
    outcomes: dict[str, dict] = {}
    candidates: list[CoopCandidate] = []
    try:
        for feed in feeds if feeds is not None else FEEDS:
            expected_host = urlparse(feed["url"]).hostname
            try:
                response = session.get(feed["url"])
                response.raise_for_status()
                if response.url.host != expected_host or len(response.content) > MAX_RESPONSE_BYTES:
                    raise ValueError("unexpected feed response")
                items = parse_feed_items(response.content, feed)
                candidates.extend(items)
                outcomes[feed["slug"]] = {"ok": True, "count": len(items)}
            except Exception as exc:  # network, HTTP or parse failure: report, keep the other feeds
                outcomes[feed["slug"]] = {"ok": False, "count": 0, "error": f"{type(exc).__name__}: {str(exc)[:160]}"}
        return candidates, outcomes
    finally:
        if owned:
            session.close()
