from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = os.getenv("WAYPOINT_API_INTERNAL_URL", "http://127.0.0.1:8000").rstrip("/")
# No fallback: setup writes a random token to .env, and the API rejects an empty one.
TOKEN = os.getenv("WAYPOINT_INTERNAL_TOKEN", "")


def request(method: str, path: str, payload: dict | None = None, grant: str | None = None) -> str:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "X-Waypoint-Internal-Token": TOKEN}
    if grant:
        headers["X-Waypoint-Grant"] = grant
    try:
        req = Request(f"{API_URL}{path}", data=body, method=method, headers=headers)
        with urlopen(req, timeout=15) as response:
            return response.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return json.dumps({"success": False, "status": exc.code, "error": detail})
    except URLError as exc:
        return json.dumps({"success": False, "error": f"Waypoint API unavailable: {exc.reason}"})
    except ValueError as exc:
        # http.client rejects malformed URLs (spaces, control characters) with ValueError.
        return json.dumps({"success": False, "error": f"Invalid tool arguments: {exc}"})
