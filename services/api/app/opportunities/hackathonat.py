from __future__ import annotations

import hashlib
import json
from datetime import date
from urllib.parse import urljoin, urlparse

import httpx

from .base import OpportunityRecord


class OpportunitySourceError(RuntimeError):
    pass


class HackathonatConnector:
    source = "hackathonat"
    base_url = "https://www.hackathonat.com"
    list_url = f"{base_url}/api/hackathons"
    max_bytes = 2_000_000

    def __init__(self, client: httpx.Client | None = None):
        self.client = client

    def fetch(self) -> list[OpportunityRecord]:
        owned = self.client is None
        client = self.client or httpx.Client(timeout=15, follow_redirects=False, headers={"User-Agent": "Farq/0.1 hackathon discovery"})
        try:
            response = client.get(self.list_url)
            response.raise_for_status()
            if "application/json" not in response.headers.get("content-type", "").lower():
                raise OpportunitySourceError("Hackathonat returned a non-JSON response")
            if len(response.content) > self.max_bytes:
                raise OpportunitySourceError("Hackathonat response exceeded the safe size limit")
            payload = response.json()
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
            raise OpportunitySourceError(f"Could not retrieve Hackathonat: {exc}") from exc
        finally:
            if owned:
                client.close()
        if not isinstance(payload, list):
            raise OpportunitySourceError("Hackathonat response must be a JSON array")
        if len(payload) > 2_000:
            raise OpportunitySourceError("Hackathonat returned too many records")
        records = [self._normalize(item) for item in payload if isinstance(item, dict)]
        return [item for item in records if item is not None]

    def _normalize(self, item: dict) -> OpportunityRecord | None:
        external_id = str(item.get("uid") or item.get("id") or "").strip()
        title = str(item.get("name") or "").strip()
        if not external_id or not title:
            return None
        raw_date = str(item.get("date") or "").strip()
        source_date = None
        if raw_date:
            try:
                source_date = date.fromisoformat(raw_date[:10]).isoformat()
            except ValueError:
                pass
        canonical = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return OpportunityRecord(
            external_id=external_id[:120],
            title=title[:300],
            organizer=str(item.get("organizer") or "").strip()[:240],
            locations=self._strings(item.get("locations")),
            topics=self._strings(item.get("sectors") or item.get("sector") or item.get("fields")),
            virtual=bool(item.get("virtual")),
            source_date=source_date,
            detail_url=self._safe_url(str(item.get("url") or f"/hackathons/{external_id}"), same_host=True),
            registration_url=self._safe_url(str(item.get("link") or ""), same_host=False),
            active=bool(item.get("isActive", True)),
            hidden=bool(item.get("isHide", False)),
            raw_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        )

    @staticmethod
    def _strings(value: object) -> list[str]:
        values = value if isinstance(value, list) else [value] if isinstance(value, str) else []
        return list(dict.fromkeys(str(item).strip()[:160] for item in values if str(item).strip()))[:40]

    def _safe_url(self, value: str, *, same_host: bool) -> str:
        if not value:
            return ""
        url = urljoin(self.base_url, value.strip())
        parsed = urlparse(url)
        if parsed.scheme != "https":
            return ""
        if same_host and parsed.hostname not in {"hackathonat.com", "www.hackathonat.com"}:
            return ""
        return url[:1200]
