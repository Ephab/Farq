from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class OpportunityRecord:
    external_id: str
    title: str
    organizer: str
    locations: list[str]
    topics: list[str]
    virtual: bool
    source_date: str | None
    detail_url: str
    registration_url: str
    active: bool
    hidden: bool
    raw_hash: str


class OpportunityConnector(Protocol):
    source: str

    def fetch(self) -> list[OpportunityRecord]: ...
