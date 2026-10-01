"""The one server-side check for internal callers (Hermes plugin, evaluator worker, importers).

There is no built-in default token: setup writes a random WAYPOINT_INTERNAL_TOKEN to `.env`.
If it is missing, this process makes up a random one, so internal routes stay closed
instead of accepting a string that is published in the repository.
"""

from __future__ import annotations

import logging
import os
import secrets
from typing import Annotated

from fastapi import Header, HTTPException

logger = logging.getLogger(__name__)

INTERNAL_TOKEN = os.getenv("WAYPOINT_INTERNAL_TOKEN", "").strip()
if not INTERNAL_TOKEN:
    INTERNAL_TOKEN = secrets.token_urlsafe(32)
    logger.warning("WAYPOINT_INTERNAL_TOKEN is not set; internal Hermes and evaluator routes are disabled. Run setup first.")


def internal_token_ok(value: str | None) -> bool:
    return bool(value) and secrets.compare_digest(value.encode(), INTERNAL_TOKEN.encode())


def require_internal(x_waypoint_internal_token: Annotated[str | None, Header()] = None) -> None:
    if not internal_token_ok(x_waypoint_internal_token):
        raise HTTPException(401, "Invalid internal token")
