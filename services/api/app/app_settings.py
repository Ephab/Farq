"""Server-wide switches in the `app_settings` table (decision engine, Hermes model, skill learning).

They survive restarts without touching .env (whose watcher restarts the API and gateway), and are
cached in this process: the API is the only writer, so a write updates the cache at once.
"""
from __future__ import annotations

from . import database

_cache: dict[str, str | None] = {}


def get_setting(key: str) -> str | None:
    """The stored value, or None when unset. A read that fails (table not created yet on first
    start, DB busy) returns None without caching, so the next call tries again."""
    if key in _cache:
        return _cache[key]
    from .models import AppSetting

    try:
        with database.SessionLocal() as db:
            row = db.get(AppSetting, key)
    except Exception:
        return None
    _cache[key] = row.value if row is not None else None
    return _cache[key]


def set_setting(key: str, value: str) -> None:
    from .models import AppSetting

    with database.SessionLocal() as db:
        row = db.get(AppSetting, key) or AppSetting(key=key)
        row.value = value
        db.add(row)
        db.commit()
    _cache[key] = value


def forget_cached_settings() -> None:
    """For tests that write app_settings rows directly."""
    _cache.clear()
