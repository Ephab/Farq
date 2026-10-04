"""Live end-to-end check of a running shared server, the way two real friends would use it.

    python scripts/smoke_check.py https://your-name.ngrok-free.dev

Two brand-new devices register, one creates a class and a project and shares invitation codes, the other joins with
them and chats. The throwaway accounts stay on the server (only the class and project are archived at the end).
Exits non-zero on the first failure.
"""
import base64
import hashlib
import secrets
import sys
import time

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HEADERS = {"ngrok-skip-browser-warning": "1", "X-Waypoint-Client-Version": "0.1.0"}


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def zero_bits(digest: bytes) -> int:
    count = 0
    for byte in digest:
        if byte == 0:
            count += 8
            continue
        return count + 8 - byte.bit_length()
    return count


def new_device(http: httpx.Client, base: str, name: str) -> dict:
    key = Ed25519PrivateKey.generate()
    public = b64(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    challenge = http.get(base + "/v1/auth/pow", headers=HEADERS).json()
    counter = 0
    while zero_bits(hashlib.sha256(f"{challenge['challenge']}:{public}:{counter}".encode()).digest()) < challenge["bits"]:
        counter += 1
    registered = http.post(base + "/v1/auth/register", headers=HEADERS, json={
        "public_key": public, "display_name": name, "challenge": challenge["challenge"], "nonce": str(counter)})
    registered.raise_for_status()
    nonce = http.post(base + "/v1/auth/challenge", headers=HEADERS, json={"public_key": public}).json()["nonce"]
    signature = b64(key.sign(b"waypoint-device-token\n" + nonce.encode()))
    token = http.post(base + "/v1/auth/token", headers=HEADERS, json={"public_key": public, "nonce": nonce, "signature": signature})
    token.raise_for_status()
    return {"headers": {**HEADERS, "Authorization": "Bearer " + token.json()["access_token"]}, "id": registered.json()["account_id"]}


def main(base: str) -> int:
    base = base.rstrip("/")
    failures = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        print(("PASS " if ok else "FAIL ") + label + (f"  [{detail}]" if detail and not ok else ""))
        if not ok:
            failures.append(label)

    with httpx.Client(timeout=60) as http:
        check("server answers", http.get(base + "/health/ready", headers=HEADERS).status_code == 200)
        check("admin and docs are not public", all(http.get(base + path, headers=HEADERS).status_code == 404 for path in ("/admin/", "/docs", "/internal/hermes/x")))
        check("no token is refused", http.get(base + "/v1/me", headers=HEADERS).status_code == 401)
        alice, bob = new_device(http, base, "Smoke Alice"), new_device(http, base, "Smoke Bob")
        check("two new devices got distinct account IDs", alice["id"] != bob["id"])
        check("a token works", http.get(base + "/v1/me", headers=alice["headers"]).json()["id"] == alice["id"])
        made = http.post(base + "/v1/classes", headers=alice["headers"], json={"title": "Smoke class"})
        check("create a class", made.status_code == 201, made.text[:100])
        class_id = made.json()["id"]
        code = http.post(base + f"/v1/classes/{class_id}/codes", headers=alice["headers"], json={}).json().get("code", "")
        check("class invitation code", len(code) >= 8)
        check("the other device cannot see the class first", http.get(base + f"/v1/classes/{class_id}", headers=bob["headers"]).status_code in (403, 404))
        check("join the class with the code", http.post(base + "/v1/codes/redeem", headers=bob["headers"], json={"code": code}).status_code == 200)
        room = http.post(base + "/v1/teams", headers=alice["headers"], json={"name": "Smoke project"})
        check("create a project", room.status_code == 201, room.text[:100])
        team_id = room.json()["id"]
        project_code = http.post(base + f"/v1/teams/{team_id}/codes", headers=alice["headers"], json={}).json().get("code", "")
        check("the other device cannot read the project first", http.get(base + f"/v1/teams/{team_id}/state", headers=bob["headers"]).status_code == 403)
        check("join the project with its code", http.post(base + "/v1/codes/redeem", headers=bob["headers"], json={"code": project_code}).status_code == 200)
        sent = http.post(base + f"/v1/teams/{team_id}/messages", headers=bob["headers"], json={"content": f"hello {secrets.token_hex(2)}"})
        seen = http.get(base + f"/v1/teams/{team_id}/state", headers=alice["headers"]).json()["messages"]
        check("a message sent by one is read by the other", sent.status_code == 201 and any(item["id"] == sent.json()["id"] for item in seen))
        if http.get(base + "/v1/capabilities", headers=alice["headers"]).json().get("team_ai"):
            asked = http.post(base + f"/v1/teams/{team_id}/messages", headers=alice["headers"], json={"content": "@hermes Reply with the single word ready."})
            check("team Hermes accepts a request", asked.status_code == 201, asked.text[:100])
            reply = None
            for _ in range(60):  # a model answer takes a few seconds; the first run after a restart can take longer
                time.sleep(3)
                messages = http.get(base + f"/v1/teams/{team_id}/state", headers=alice["headers"]).json()["messages"]
                reply = next((m for m in messages if m["id"] != asked.json()["id"] and m.get("author_user_id") != alice["id"]
                              and m.get("author_user_id") != bob["id"] and m["kind"] != "system"), None)
                if reply:
                    break
            check("team Hermes answers in the project chat", reply is not None)
        else:
            print("SKIP team Hermes (not enabled on this server)")
        http.post(base + f"/v1/teams/{team_id}/archive", headers=alice["headers"])
        http.post(base + f"/v1/classes/{class_id}/archive", headers=alice["headers"])
    print(f"\n{'All checks passed' if not failures else str(len(failures)) + ' check(s) failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].startswith(("https://", "http://127.0.0.1", "http://localhost")):
        raise SystemExit("Usage: python scripts/smoke_check.py https://your-name.ngrok-free.dev")
    raise SystemExit(main(sys.argv[1]))
