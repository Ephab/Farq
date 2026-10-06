#!/usr/bin/env python3
"""Waypoint's host-side project evaluator.

The worker is intentionally outside the Hermes container. It accepts only
server-validated jobs, snapshots the source, and performs structural inspection
using a bounded native QA agent. No Docker is required. See docs/evaluator-threat-model.md.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import ast
import re
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


API = os.getenv("WAYPOINT_API_URL", "http://127.0.0.1:8000").rstrip("/")
# No fallback: the API has no built-in token (setup writes one to .env).
TOKEN = os.getenv("WAYPOINT_INTERNAL_TOKEN", "")
MAX_FILES = 5000
MAX_BYTES = 250 * 1024 * 1024
REPO = Path(__file__).resolve().parents[1]
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "dist", "build", "__pycache__", ".next"}
SECRET_NAMES = {".env", ".env.local", ".npmrc", ".pypirc", "credentials", "secrets.json", "id_rsa", "id_ed25519"}


def request(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={"Content-Type": "application/json", "X-Waypoint-Internal-Token": TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=150 if path.endswith("/reason") else 30) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read(2000).decode("utf-8", errors="replace")
        raise RuntimeError(f"Evaluator API HTTP {exc.code}: {detail}") from exc


def request_bytes(path: str) -> bytes:
    req = urllib.request.Request(f"{API}{path}", headers={"X-Waypoint-Internal-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read(MAX_BYTES + 1)


def safe_copy(source: Path, target: Path) -> dict:
    files = total = 0
    extensions: dict[str, int] = {}
    for directory, dirs, names in os.walk(source, followlinks=False):
        dirs[:] = [name for name in dirs if name not in SKIP_DIRS
                   and not (Path(directory) / name).is_symlink()
                   and not getattr(Path(directory) / name, "is_junction", lambda: False)()]
        for name in names:
            path = Path(directory) / name
            if path.is_symlink() or name.lower() in SECRET_NAMES or name.lower().startswith(".env") or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx"}:
                continue
            if not path.is_file():
                continue
            size = path.stat().st_size
            files += 1; total += size
            if files > MAX_FILES or total > MAX_BYTES:
                raise RuntimeError("Project exceeds the evaluator snapshot limit")
            destination = target / path.relative_to(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, destination)
            extensions[path.suffix.lower()] = extensions.get(path.suffix.lower(), 0) + 1
    return {"files": files, "bytes": total, "extensions": extensions}


def materialize(job: dict, target: Path) -> dict:
    submission = job["submission"]
    if submission["source_type"] == "github":
        subprocess.run(["git", "clone", "--depth", "1", "--", submission["source_ref"], str(target)], check=True, timeout=120, capture_output=True, text=True)
        git_dir = target / ".git"
        if git_dir.exists(): shutil.rmtree(git_dir)
        return safe_copy(target, target.parent / "snapshot")
    if submission["source_type"] == "zip":
        archive = target.parent / "project.zip"
        content = request_bytes(f"/internal/evaluator/submissions/{submission['id']}/archive")
        if len(content) > MAX_BYTES:
            raise RuntimeError("Project archive exceeds the evaluator limit")
        archive.write_bytes(content)
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            if len(members) > MAX_FILES or sum(member.file_size for member in members) > MAX_BYTES:
                raise RuntimeError("Project archive exceeds the evaluator extraction limit")
            root = target.resolve()
            for member in members:
                destination = (target / member.filename).resolve()
                if root not in destination.parents and destination != root:
                    raise RuntimeError("Project archive contains an unsafe path")
                if member.is_dir():
                    destination.mkdir(parents=True, exist_ok=True); continue
                if any(part in SKIP_DIRS for part in Path(member.filename).parts) or Path(member.filename).name.lower() in SECRET_NAMES:
                    continue
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(member) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
        return {"files": sum(1 for path in target.rglob("*") if path.is_file()), "bytes": sum(path.stat().st_size for path in target.rglob("*") if path.is_file()), "extensions": {}}
    source = Path(submission["source_ref"]).resolve(strict=True)
    if not source.is_dir():
        raise RuntimeError("The local project path is not a directory")
    return safe_copy(source, target)


def detect_adapter(root: Path) -> str:
    if (root / "package.json").exists():
        package = json.loads((root / "package.json").read_text(encoding="utf-8-sig"))
        return "web" if any(name in json.dumps(package).lower() for name in ["react", "vite", "next", "vue", "svelte"]) else "software"
    if (root / "requirements.txt").exists() or (root / "pyproject.toml").exists():
        return "data_ml" if any(root.rglob("*.ipynb")) else "software"
    extensions = {path.suffix.lower() for path in root.rglob("*") if path.is_file()}
    if extensions & {".kicad_pcb", ".kicad_sch", ".sch"}: return "circuit"
    if extensions & {".step", ".stp", ".stl", ".fcstd", ".dwg", ".dxf"}: return "cad"
    if extensions & {".pdf", ".docx", ".pptx", ".md", ".tex"}: return "document"
    return "generic"


def native_inspect(root: Path) -> tuple[bool, str]:
    """Parse source without importing it or executing submitted scripts."""
    issues = []
    checked = 0
    for path in root.rglob("*.py"):
        try:
            ast.parse(path.read_bytes(), filename=str(path.relative_to(root)))
            checked += 1
        except (SyntaxError, ValueError) as exc:
            issues.append(f"{path.relative_to(root)}: {exc}")
    package_path = root / "package.json"
    if package_path.exists():
        package = json.loads(package_path.read_text(encoding="utf-8-sig"))
        if not isinstance(package, dict):
            raise RuntimeError("package.json must contain an object")
        checked += 1
    return not issues, f"Parsed {checked} Python/package files. No project code, test scripts, or builds were executed.\n" + "\n".join(issues)[:10000]


def redact(value: str) -> str:
    for name, secret in os.environ.items():
        if any(word in name.upper() for word in ("TOKEN", "KEY", "SECRET", "PASSWORD")) and len(secret) >= 8:
            value = value.replace(secret, "[secret]")
    value = re.sub(r"(?i)((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+", r"\1[secret]", value)
    return value


def project_context(root: Path, manifest: dict) -> str:
    paths = sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file())
    parts = ["Snapshot: " + json.dumps(manifest), "Files: " + json.dumps(paths[:250])]
    candidates = [root / name for name in ("README.md", "package.json", "pyproject.toml", "requirements.txt")]
    candidates += sorted(path for path in root.rglob("*") if path.is_file() and path.suffix in {".js", ".mjs", ".py", ".tsx", ".ts", ".html"} and "runs" not in path.parts)[:16]
    seen = set()
    for path in candidates:
        if not path.is_file() or path in seen:
            continue
        seen.add(path)
        text = path.read_text(encoding="utf-8-sig", errors="replace")[:9000]
        parts.append(f"UNTRUSTED FILE {path.relative_to(root)}:\n{text}")
    return redact("\n\n".join(parts))[:60000]


def run_job(job: dict) -> None:
    from evaluator_native import NativeSession
    job_id = job["id"]
    lease = job["lease_token"]
    def stage(text):
        print(f"Evaluation {job_id}: {text}", flush=True)
        request("POST", f"/internal/evaluator/jobs/{job_id}/progress", {"lease_token": lease, "stage": text[:100]})
    try:
        if job["submission"]["source_type"] != "local_directory":
            raise RuntimeError("Native execution is authorized only for explicitly submitted local directories. Remote/ZIP execution needs a sandbox.")
        if os.getenv("WAYPOINT_EVALUATOR_NATIVE", "0") != "1":
            raise RuntimeError("Native execution is disabled. Set WAYPOINT_EVALUATOR_NATIVE=1 locally only for trusted submitted projects.")
        stage("Snapshotting your project")
        with tempfile.TemporaryDirectory(prefix="waypoint-eval-") as temporary:
            root = Path(temporary) / "project"; root.mkdir()
            manifest = materialize(job, root)
            context = project_context(root, manifest)
            adapter = detect_adapter(root)
            observations = []
            runtime_checks = 0
            session = NativeSession(root)
            try:
                seen_actions = set()
                for index in range(8):
                    stage(f"QA agent choosing check {index + 1}")
                    payload = {"lease_token": lease, "phase": "next", "context": context,
                               "observations": observations, "remaining": 8 - index}
                    try:
                        answer = request("POST", f"/internal/evaluator/jobs/{job_id}/reason", payload)
                    except Exception as exc:
                        if not runtime_checks:
                            raise
                        observations.append({"id": f"check-{index+1}", "title": "Agent could not plan another valid check", "kind": "planning",
                                             "passed": False, "output": redact(str(exc))[:16000], "duration_ms": 0})
                        break
                    action = answer["action"]
                    if action["kind"] == "finish":
                        break
                    signature = json.dumps({key: value for key, value in action.items() if key != "title"}, sort_keys=True)
                    if signature in seen_actions:
                        break
                    seen_actions.add(signature)
                    stage(action["title"])
                    started = time.monotonic()
                    before = session.executed_checks
                    try:
                        passed, output = session.execute(action)
                    except Exception as exc:
                        passed, output = False, str(exc)
                    if action["kind"] not in {"install_dependencies", "start_server"} and session.executed_checks > before:
                        runtime_checks += 1
                    observations.append({"id": f"check-{index+1}", "title": action["title"], "kind": action["kind"],
                                         "passed": passed, "output": redact(output)[-16000:], "duration_ms": int((time.monotonic()-started)*1000)})
                    request("POST", f"/internal/evaluator/jobs/{job_id}/progress", {"lease_token": lease, "stage": "Recorded runtime evidence", "observations": observations})
                    print(f"Evaluation {job_id}: {observations[-1]['id']} {'PASS' if passed else 'FAIL'}", flush=True)
                if not observations or not runtime_checks:
                    raise RuntimeError("The QA agent did not produce runtime evidence; no score was published")
                stage("Reviewing observed behavior against your rubric")
                answer = request("POST", f"/internal/evaluator/jobs/{job_id}/reason",
                                 {"lease_token": lease, "phase": "review", "context": context, "observations": observations})
                review = answer["review"]
                review.setdefault("limitations", []).append("Native execution used a temporary copy and stripped credentials; it is not an OS sandbox.")
                payload = {**review, "lease_token": lease, "adapter": adapter, "observations": observations, "screenshots": session.screenshots}
                request("POST", f"/internal/evaluator/jobs/{job_id}/complete", payload)
                print(f"Evaluation {job_id}: review complete ({review['score']}/100)", flush=True)
            finally:
                session.close()
    except Exception as exc:
        print(f"Evaluation {job_id} failed: {exc}", flush=True)
        try: request("POST", f"/internal/evaluator/jobs/{job_id}/fail", {"lease_token": lease, "error": str(exc)[:3000]})
        except Exception as failure: print(f"Could not report evaluation failure: {failure}", flush=True)


def main() -> None:
    print(f"Waypoint evaluator connected to {API}. Ctrl+C to stop.")
    if not TOKEN:
        raise RuntimeError("WAYPOINT_INTERNAL_TOKEN is missing; run setup first.")
    def heartbeat():
        while True:
            try:
                request("POST", "/internal/evaluator/heartbeat", {})
            except (urllib.error.URLError, TimeoutError, OSError):
                pass
            time.sleep(2)
    threading.Thread(target=heartbeat, daemon=True).start()
    waiting = False  # report losing and regaining the API once each, not on every retry
    while True:
        try:
            request("POST", "/internal/evaluator/heartbeat", {})
            if waiting:
                print("Evaluator reconnected to the API.", flush=True)
                waiting = False
            payload = request("POST", "/internal/evaluator/jobs/claim", {})
            if payload.get("job"): run_job(payload["job"])
            else: time.sleep(2)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if not waiting:
                print(f"Evaluator waiting for API: {exc} (retrying quietly)", flush=True)
                waiting = True
            time.sleep(3)


if __name__ == "__main__": main()
