from __future__ import annotations
import json
import re
from datetime import datetime, timedelta, timezone
from html import unescape
from urllib.parse import urlsplit
from sqlalchemy import case, delete, select
from sqlalchemy.orm import Session
from ..models import RoadmapVersion, now
from ..sources.pdf_text import redact
from ..student_memory import disabled_connectors
from .catalog import TOPICS, PLATFORMS, matches
from .models import Dismissal, Post, PostTopic, Subscription


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def enabled_platforms(db: Session, student_id: str) -> list[str]:
    off = disabled_connectors(db, student_id)
    return [p for p in PLATFORMS if "learning_" + p not in off]


def subscriptions(db: Session, student_id: str) -> list[str]:
    return list(db.scalars(select(Subscription.topic_id).where(Subscription.student_id == student_id)).all())


def roadmap_matches(db: Session, student_id: str) -> dict[str, list[str]]:
    version = db.scalar(select(RoadmapVersion).where(RoadmapVersion.student_id == student_id, RoadmapVersion.active.is_(True)))
    result = {key: [] for key in TOPICS}
    if version is None:
        return result
    nodes = json.loads(version.snapshot_json).get("nodes", [])
    for node in nodes:
        if not isinstance(node, dict):
            continue
        title = str(node.get("title", ""))[:240]
        skills = node.get("skills", [])
        subtopics = node.get("subtopics", [])  # roadmap skill labels use subtopics in the current schema
        labels = (skills if isinstance(skills, list) else []) + (subtopics if isinstance(subtopics, list) else [])
        text = title + " " + " ".join(str(s)[:240] for s in labels[:50])
        for key, topic in TOPICS.items():
            if matches(text, topic.aliases):
                result[key].append(title)
    return result


def clean(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = unescape(value[:20000])
    text = re.sub(r"<[^>]*>", " ", text)
    text = re.sub(r"(?i)(?:password|api[_ -]?key|secret|token)\s*[:=]\s*\S+|\b(?:sk-|hf_|ghp_|AIza)[A-Za-z0-9_-]{16,}", "[secret]", text)
    text = re.sub(r"[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]", " ", text)
    return re.sub(r"\s+", " ", redact(text)).strip()[:limit]


def publication(value) -> datetime | None:
    try:
        if isinstance(value, (float, int)) and not isinstance(value, bool):
            return datetime.fromtimestamp(value, timezone.utc)
        if isinstance(value, str):
            try:
                return utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
            except ValueError:
                return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y").astimezone(timezone.utc)
    except (ValueError, OverflowError, OSError):
        pass
    return None


def normalize(record, topic_id: str, platform: str, since: datetime, until: datetime) -> dict | None:
    """Reject unverifiable identity, dates and links; never guess publication time."""
    if not isinstance(record, dict):
        return None
    topic = TOPICS[topic_id]
    if platform == "reddit":
        flags = record.get("content_flags") or []
        if not isinstance(flags, (list, str)):
            return None
        if record.get("kind", "post") != "post" or record.get("over_18") or record.get("isNsfw") or record.get("nsfw") or "nsfw" in flags:
            return None
        source = record.get("subreddit") or record.get("subredditName")
        if not isinstance(source, str) or source.lower().removeprefix("r/") != topic.subreddit.lower():
            return None
        source = topic.subreddit
        ident = str(record.get("id", "")).removeprefix("t3_")
        if not re.fullmatch(r"[a-z0-9]{3,20}", ident):
            return None
        link = record.get("permalink") or record.get("post_url") or record.get("url")
        if isinstance(link, str) and link.startswith("/r/"):
            link = "https://www.reddit.com" + link
        title = clean(record.get("title"), 240)
        excerpt = clean(record.get("body") or record.get("selftext"), 800)
        published = publication(record.get("created_utc") or record.get("createdAt") or record.get("created_at"))
        engagement = record.get("score", 0)
        pattern = rf"/r/{re.escape(source)}/comments/{re.escape(ident)}(?:/[^/?#]+)?/?"
        hosts = {"reddit.com", "www.reddit.com"}
        canonical = f"https://www.reddit.com/r/{source}/comments/{ident}/"
    else:
        author = record.get("author")
        source = author.get("userName") if isinstance(author, dict) else None
        accounts = {a.lower(): a for a in topic.accounts}
        if not isinstance(source, str) or source.lower() not in accounts or record.get("isRetweet") or record.get("isReply"):
            return None
        source = accounts[source.lower()]
        ident = str(record.get("id", ""))
        if not re.fullmatch(r"[0-9]{5,30}", ident):
            return None
        link = record.get("url") or record.get("twitterUrl")
        excerpt = clean(record.get("text") or record.get("fullText"), 800)
        title = excerpt[:240]
        published = publication(record.get("createdAt"))
        engagement = record.get("likeCount", 0)
        pattern = rf"/{re.escape(source)}/status/{re.escape(ident)}/?"
        hosts = {"x.com", "www.x.com", "twitter.com", "www.twitter.com"}
        canonical = f"https://x.com/{source}/status/{ident}"
    if not isinstance(link, str) or len(link) > 1000:
        return None
    try:
        parsed = urlsplit(link)
        if parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password or parsed.port or not re.fullmatch(pattern, parsed.path, re.I):
            return None
    except ValueError:
        return None
    if not title or published is None or not utc(since) <= published <= utc(until):
        return None
    if not matches(title + " " + excerpt, topic.keywords + topic.aliases):
        return None
    engagement = max(0, min(1000000000, engagement)) if isinstance(engagement, int) and not isinstance(engagement, bool) else 0
    return dict(platform=platform, platform_id=ident, url=canonical, title=title, excerpt=excerpt,
                source=source, published_at=published, fetched_at=now(), engagement=engagement)


def no_results(record) -> bool:
    return isinstance(record, dict) and len(record) == 1 and record.get("noResults") is True


def store_posts(db: Session, rows: list, topic_id: str, platform: str, since, until) -> tuple[int, int]:
    accepted, rejected = 0, 0
    seen = set()
    for raw in rows[:50]:
        # X emits this control record instead of a post for an empty search.
        if platform == "x" and no_results(raw):
            continue
        record = normalize(raw, topic_id, platform, since, until)
        if record is None:
            rejected += 1
            continue
        if record["platform_id"] in seen:
            continue
        seen.add(record["platform_id"])
        post = db.scalar(select(Post).where(Post.platform == platform, Post.platform_id == record["platform_id"]))
        if post is None:
            post = Post(**record)
            db.add(post)
            db.flush()
        else:
            for key, value in record.items():
                setattr(post, key, value)
        if db.get(PostTopic, (post.id, topic_id)) is None:
            db.add(PostTopic(post_id=post.id, topic_id=topic_id))
        accepted += 1
    return accepted, rejected


def prune(db: Session) -> None:
    expired = select(Post.id).where(Post.published_at < now() - timedelta(days=30))
    db.execute(delete(Dismissal).where(Dismissal.post_id.in_(expired)))
    db.execute(delete(PostTopic).where(PostTopic.post_id.in_(expired)))
    db.execute(delete(Post).where(Post.id.in_(expired)))


def feed(db: Session, student_id: str, platform: str | None = None, limit: int = 30) -> list[dict]:
    platforms = enabled_platforms(db, student_id)
    if platform:
        platforms = [p for p in platforms if p == platform]
    followed = subscriptions(db, student_id)
    if not platforms or not followed:
        return []
    relevance = roadmap_matches(db, student_id)
    dismissed = select(Dismissal.post_id).where(Dismissal.student_id == student_id)
    topic_score = case(*[(PostTopic.topic_id == key, len(relevance[key])) for key in followed], else_=0)
    pairs = db.execute(select(Post, PostTopic.topic_id).join(PostTopic).where(
        Post.platform.in_(platforms), PostTopic.topic_id.in_(followed), Post.id.not_in(dismissed),
        Post.published_at >= now() - timedelta(days=30)).order_by(topic_score.desc(), Post.published_at.desc(), Post.engagement.desc()).limit(1000)).all()
    combined = {}
    for post, topic in pairs:
        item = combined.setdefault(post.id, {"id": post.id, "platform": post.platform, "url": post.url,
            "title": post.title, "excerpt": post.excerpt, "source": post.source,
            "published_at": utc(post.published_at).isoformat(), "fetched_at": utc(post.fetched_at).isoformat(),
            "topics": [], "related_nodes": [], "report_kind": "announcement" if post.platform == "x" else "community_report",
            "untrusted": True, "_score": 0, "_engagement": post.engagement})
        item["topics"].append(topic)
        item["related_nodes"].extend(relevance[topic][:5])
        item["_score"] = max(item["_score"], len(relevance[topic]))
    ordered = sorted(combined.values(), key=lambda p: (p["_score"], p["published_at"], p["_engagement"], p["id"]), reverse=True)[:limit]
    for item in ordered:
        item.pop("_score"); item.pop("_engagement")
    return ordered
