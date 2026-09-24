from __future__ import annotations

"""Public web sources: GitHub, ORCID, and one portfolio page.

GitHub and ORCID use fixed API hosts. The portfolio fetch is the only
arbitrary-URL request in Farq, so it is guarded against SSRF: https only,
every hop's host must resolve to public addresses, bounded size and time.
"""

import ipaddress
import os
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx

from ..schemas import EvidenceIn
from . import SourceError

GITHUB_API = "https://api.github.com"
ORCID_API = "https://pub.orcid.org/v3.0"
MAX_PAGE_BYTES = 1024 * 1024
MAX_REDIRECTS = 3
TOP_README_REPOS = 8


def _github_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "farq-onboarding"}
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_github(username: str) -> list[EvidenceIn]:
    try:
        with httpx.Client(timeout=15, headers=_github_headers()) as client:
            user = client.get(f"{GITHUB_API}/users/{username}")
            if user.status_code == 404:
                raise SourceError("GitHub user not found", status=404)
            if user.status_code == 403:
                raise SourceError("GitHub rate limit reached; set GITHUB_TOKEN on the server or try later", status=429)
            user.raise_for_status()
            repos = client.get(f"{GITHUB_API}/users/{username}/repos", params={"per_page": 100, "sort": "pushed"})
            repos.raise_for_status()
            repo_list = [repo for repo in repos.json() if not repo.get("fork") and not repo.get("archived")]
            items: list[EvidenceIn] = []
            for index, repo in enumerate(repo_list[:40]):
                languages: list[str] = []
                readme = ""
                if index < TOP_README_REPOS:
                    lang = client.get(repo["languages_url"])
                    if lang.status_code == 200:
                        languages = list(lang.json().keys())[:6]
                    head = client.get(f"{GITHUB_API}/repos/{repo['full_name']}/readme", headers={"Accept": "application/vnd.github.raw"})
                    if head.status_code == 200:
                        readme = re.sub(r"\s+", " ", re.sub(r"<[^>]+>|!\[[^\]]*\]\([^)]*\)", " ", head.text))[:500].strip()
                items.append(EvidenceIn(
                    kind="project",
                    title=repo["name"],
                    source_ref=repo["html_url"],
                    fingerprint=f"project:{repo['html_url'].lower()}",
                    data={
                        "url": repo["html_url"],
                        "summary": (repo.get("description") or readme[:240] or "").strip(),
                        "readme_excerpt": readme,
                        "languages": languages or ([repo["language"]] if repo.get("language") else []),
                        "topics": repo.get("topics", [])[:8],
                        "stars": repo.get("stargazers_count", 0),
                        "last_active": (repo.get("pushed_at") or "")[:10],
                        "origin": "github",
                    },
                ))
    except SourceError:
        raise
    except httpx.HTTPError as exc:
        raise SourceError(f"GitHub is unavailable: {exc}", status=502) from exc
    if not items:
        raise SourceError("No public, non-fork repositories were found for this user")
    return items


def fetch_orcid(orcid: str) -> list[EvidenceIn]:
    headers = {"Accept": "application/json"}
    items: list[EvidenceIn] = []
    try:
        with httpx.Client(timeout=15, headers=headers) as client:
            works = client.get(f"{ORCID_API}/{orcid}/works")
            if works.status_code == 404:
                raise SourceError("ORCID record not found", status=404)
            works.raise_for_status()
            for group in works.json().get("group", [])[:60]:
                summary = (group.get("work-summary") or [{}])[0]
                title = ((summary.get("title") or {}).get("title") or {}).get("value")
                if not title:
                    continue
                year = ((summary.get("publication-date") or {}).get("year") or {}).get("value", "")
                doi = next((ext.get("external-id-value") for ext in (summary.get("external-ids") or {}).get("external-id", []) if ext.get("external-id-type") == "doi"), "")
                items.append(EvidenceIn(kind="publication", title=title[:240], source_ref=f"https://orcid.org/{orcid}",
                                        fingerprint=f"doi:{doi}" if doi else None,
                                        data={"venue": ((summary.get("journal-title") or {}) or {}).get("value", ""), "year": year, "doi": doi, "type": summary.get("type", "")}))
            for section, kind in (("employments", "experience"), ("educations", "education")):
                response = client.get(f"{ORCID_API}/{orcid}/{section}")
                if response.status_code != 200:
                    continue
                for group in response.json().get("affiliation-group", [])[:30]:
                    for entry in group.get("summaries", []):
                        record = next(iter(entry.values()), {})
                        org = (record.get("organization") or {}).get("name", "")
                        role = record.get("role-title") or record.get("department-name") or ""
                        if org:
                            items.append(EvidenceIn(kind=kind, title=" at ".join(p for p in (role, org) if p)[:240], source_ref=f"https://orcid.org/{orcid}",
                                                    data={"org": org, "role": role, "start": ((record.get("start-date") or {}).get("year") or {}).get("value", "")}))
    except SourceError:
        raise
    except httpx.HTTPError as exc:
        raise SourceError(f"ORCID is unavailable: {exc}", status=502) from exc
    if not items:
        raise SourceError("This ORCID record has no public works or affiliations")
    return items


def ensure_public_host(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise SourceError(f"Could not resolve {host}") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global or address.is_multicast:
            raise SourceError("That URL points to a private or local network address", status=422)


class _TextExtractor(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        if tag == "a":
            href = dict(attrs).get("href")
            if href and href.startswith("http"):
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def fetch_page_text(url: str) -> str:
    """Fetch one public page with SSRF guards and return visible text + links."""
    current = url
    with httpx.Client(timeout=10, follow_redirects=False, headers={"User-Agent": "farq-onboarding"}) as client:
        for _ in range(MAX_REDIRECTS + 1):
            parsed = urlparse(current)
            if parsed.scheme != "https" or not parsed.hostname:
                raise SourceError("Only public https:// pages can be read")
            ensure_public_host(parsed.hostname)
            try:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        current = urljoin(current, response.headers.get("location", ""))
                        continue
                    if response.status_code >= 400:
                        raise SourceError(f"The page returned HTTP {response.status_code}", status=502)
                    if "html" not in response.headers.get("content-type", "") and "text" not in response.headers.get("content-type", ""):
                        raise SourceError("That URL is not a web page")
                    body = b""
                    for chunk in response.iter_bytes():
                        body += chunk
                        if len(body) > MAX_PAGE_BYTES:
                            break
            except httpx.HTTPError as exc:
                raise SourceError(f"Could not fetch the page: {exc}", status=502) from exc
            parser = _TextExtractor()
            parser.feed(body.decode("utf-8", errors="replace"))
            text = " ".join(parser.parts)
            links = "\n".join(dict.fromkeys(parser.links[:40]))
            if len(text) < 40:
                raise SourceError("The page has almost no readable text (it may need JavaScript)")
            return f"{text[:20000]}\n\nLinks on the page:\n{links}"
    raise SourceError("Too many redirects")
