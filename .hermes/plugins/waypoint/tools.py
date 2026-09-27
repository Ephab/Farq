from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = os.getenv("WAYPOINT_API_INTERNAL_URL", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.getenv("WAYPOINT_INTERNAL_TOKEN", "waypoint-internal-dev")


def request(method: str, path: str, payload: dict | None = None) -> str:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(
        f"{API_URL}{path}",
        data=body,
        method=method,
        headers={"Content-Type": "application/json", "X-Waypoint-Internal-Token": TOKEN},
    )
    try:
        with urlopen(req, timeout=15) as response:
            return response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return json.dumps({"success": False, "status": exc.code, "error": detail})
    except URLError as exc:
        return json.dumps({"success": False, "error": f"Waypoint API unavailable: {exc.reason}"})

