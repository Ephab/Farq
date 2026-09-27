"""Smoke every read-only Blackboard endpoint backing the Hermes tools."""

from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


REPO = Path(__file__).resolve().parents[1]


def env_values() -> dict[str, str]:
    result: dict[str, str] = {}
    path = REPO / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                result[key.strip()] = value.strip().strip('"').strip("'")
    return result


def get(path: str, token: str) -> dict:
    request = Request(
        f"http://127.0.0.1:8000{path}",
        headers={"X-Farq-Internal-Token": token},
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    token = os.getenv("FARQ_INTERNAL_TOKEN") or env_values().get("FARQ_INTERNAL_TOKEN", "farq-internal-dev")
    user = "demo-student"
    courses = get(f"/internal/hermes/students/{user}/blackboard/courses", token)
    assert courses["courses"], "import the Blackboard demo snapshot first"
    course = courses["courses"][0]
    content = get(f"/internal/hermes/students/{user}/blackboard/courses/{course['id']}/content?limit=10", token)
    assert content["items"]
    item = content["items"][0]
    query = quote(item["title"].split()[0])
    search = get(f"/internal/hermes/students/{user}/blackboard/search?query={query}&limit=5", token)
    assert search["results"]
    read = get(f"/internal/hermes/students/{user}/blackboard/items/{search['results'][0]['id']}?cursor=0", token)
    assert "text" in read and "next_cursor" in read
    updates = get(f"/internal/hermes/students/{user}/blackboard/updates?since=1970-01-01T00:00:00Z&limit=10", token)
    assert updates["items"]
    print(json.dumps({
        "farq_blackboard_list_courses": len(courses["courses"]),
        "farq_blackboard_list_content": len(content["items"]),
        "farq_blackboard_search": len(search["results"]),
        "farq_blackboard_read_item": len(read["text"]),
        "farq_blackboard_list_updates": len(updates["items"]),
    }, indent=2))


if __name__ == "__main__":
    main()
