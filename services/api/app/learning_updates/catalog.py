"""Versioned, host-reviewed sources; no student content enters scraper inputs."""
import re
from datetime import timedelta
from dataclasses import dataclass

VERSION = "2026-10-04.v1"

@dataclass(frozen=True)
class Topic:
    id: str
    label: str
    aliases: tuple[str, ...]
    keywords: tuple[str, ...]
    subreddit: str
    accounts: tuple[str, ...]

TOPICS = {
    t.id: t for t in (
        Topic("software", "Software development", ("software", "programming", "git", "github", "javascript", "typescript", "react", "web development"), ("software", "release", "developer"), "programming", ("github",)),
        Topic("ai", "AI and machine learning", ("ai", "artificial intelligence", "machine learning", "deep learning", "computer vision", "pytorch", "neural", "transformer"), ("model", "pytorch", "release", "learning"), "MachineLearning", ("huggingface", "pytorch", "GoogleDeepMind")),
        Topic("data", "Data science", ("data science", "data analysis", "numpy", "pandas", "statistics", "sql"), ("data", "analysis", "release"), "datascience", ("huggingface",)),
        Topic("security", "Cybersecurity", ("cybersecurity", "security", "cryptography", "penetration testing", "network security"), ("security", "vulnerability", "release"), "cybersecurity", ("github",)),
    )
}
PLATFORMS = ("reddit", "x")
ACTORS = {"x": "apidojo/tweet-scraper", "reddit": "fatihtahta/reddit-scraper-search-fast"}


def matches(text: str, terms: tuple[str, ...]) -> bool:
    return any(re.search(r"(?<![\w])" + re.escape(term) + r"(?![\w])", text, re.I) for term in terms)


def payload(topic_id: str, platform: str, since, until) -> dict:
    topic = TOPICS[topic_id]
    if platform == "x":
        accounts = " OR ".join("from:" + account for account in topic.accounts)
        words = " OR ".join(topic.keywords)
        return {"searchTerms": [f"({accounts}) ({words}) since:{since.date()} until:{(until + timedelta(days=1)).date()} -filter:replies -filter:retweets"],
                "sort": "Latest", "maxItems": 50}
    return {"subredditName": topic.subreddit, "subredditKeywords": [" OR ".join(topic.keywords)],
            "subredditSort": "new", "subredditTimeframe": "week", "dateFrom": since.isoformat(),
            "dateTo": until.isoformat(), "maxPosts": 50, "scrapeComments": False,
            "includeNsfw": False, "maximize_coverage": False, "mcpConnectors": []}
