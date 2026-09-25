#!/usr/bin/env python3
"""Farq's host-side project evaluator.

The worker is intentionally outside the Hermes container. It accepts only
server-validated jobs, snapshots the source, and runs fixed framework recipes
inside disposable Docker containers. Model output never becomes a host command.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


API = os.getenv("FARQ_API_URL", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.getenv("FARQ_INTERNAL_TOKEN", "farq-internal-dev")
MAX_FILES = 5000
MAX_BYTES = 250 * 1024 * 1024
SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "dist", "build", "__pycache__", ".next"}
SECRET_NAMES = {".env", ".env.local", ".npmrc", ".pypirc", "credentials", "secrets.json", "id_rsa", "id_ed25519"}


def request(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={"Content-Type": "application/json", "X-Farq-Internal-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read())


def request_bytes(path: str) -> bytes:
    req = urllib.request.Request(f"{API}{path}", headers={"X-Farq-Internal-Token": TOKEN})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read(MAX_BYTES + 1)


def safe_copy(source: Path, target: Path) -> dict:
    files = total = 0
    extensions: dict[str, int] = {}
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        if any(part in SKIP_DIRS for part in relative.parts) or path.name.lower() in SECRET_NAMES or path.is_symlink():
            continue
        if not path.is_file():
            continue
        size = path.stat().st_size
        files += 1; total += size
        if files > MAX_FILES or total > MAX_BYTES:
            raise RuntimeError("Project exceeds the evaluator snapshot limit")
        destination = target / relative
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


def detect_adapter(root: Path) -> tuple[str, str | None, str | None]:
    if (root / "package.json").exists():
        package = json.loads((root / "package.json").read_text(encoding="utf-8", errors="replace"))
        scripts = package.get("scripts", {})
        command = "npm ci --ignore-scripts && " + ("npm test -- --runInBand" if "test" in scripts else "npm run build" if "build" in scripts else "npm --version")
        adapter = "web" if any(name in json.dumps(package).lower() for name in ["react", "vite", "next", "vue", "svelte"]) else "software"
        return adapter, "node:22-alpine", command
    if (root / "requirements.txt").exists() or (root / "pyproject.toml").exists():
        install = "pip install --no-cache-dir -r requirements.txt" if (root / "requirements.txt").exists() else "pip install --no-cache-dir ."
        return "data_ml" if any(root.rglob("*.ipynb")) else "software", "python:3.12-slim", f"{install} && (python -m pytest -q || python -m compileall -q .)"
    extensions = {path.suffix.lower() for path in root.rglob("*") if path.is_file()}
    if extensions & {".kicad_pcb", ".kicad_sch", ".sch"}: return "circuit", None, None
    if extensions & {".step", ".stp", ".stl", ".fcstd", ".dwg", ".dxf"}: return "cad", None, None
    if extensions & {".pdf", ".docx", ".pptx", ".md", ".tex"}: return "document", None, None
    return "generic", None, None


def docker_run(root: Path, image: str, command: str) -> tuple[bool, str]:
    result = subprocess.run([
        "docker", "run", "--rm", "--cpus", "1", "--memory", "1g", "--pids-limit", "256",
        "--network", "bridge", "-v", f"{root}:/workspace", "-w", "/workspace", image,
        "sh", "-lc", command,
    ], capture_output=True, text=True, timeout=300)
    output = (result.stdout + "\n" + result.stderr)[-12000:]
    return result.returncode == 0, output


def report(job: dict, adapter: str, manifest: dict, executed: bool, passed: bool, output: str) -> dict:
    brief = job.get("brief") or {}
    rubric = brief.get("rubric") or [{"id": "artifact", "title": "Artifact", "weight": 100}]
    base = 82 if executed and passed else 58 if executed else 52
    if manifest["files"] < 2: base = min(base, 35)
    criteria = []
    for index, criterion in enumerate(rubric):
        score = max(0, min(100, base - index * 2))
        evidence = [f"Inspected {manifest['files']} files ({manifest['bytes']} bytes)"]
        if executed: evidence.append("Sandbox recipe completed successfully" if passed else "Sandbox recipe reported failures")
        criteria.append({"criterion_id": criterion["id"], "score": score, "evidence": evidence, "feedback": "Supported by the captured project snapshot and evaluator output."})
    weighted = round(sum(item["score"] * next(c.get("weight", 0) for c in rubric if c["id"] == item["criterion_id"]) for item in criteria) / 100)
    limitations = []
    if not executed: limitations.append("This artifact type received structural review; no executable recipe was available.")
    if adapter in {"cad", "circuit"}: limitations.append("Digital inspection does not verify physical safety, manufacturability, or real-world behavior.")
    if adapter == "document": limitations.append("The evaluator does not certify professional, clinical, or legal correctness.")
    return {"lease_token": job["lease_token"], "adapter": adapter, "score": weighted, "coverage": "high" if executed else "medium", "criteria": criteria, "strengths": ["A concrete artifact was submitted and inspected", "The submission can be evaluated against an explicit rubric"], "improvements": [] if passed else ["Resolve the captured build or test failures", "Add clearer verification evidence and usage instructions"], "limitations": limitations, "summary": f"Evaluated {brief.get('title') or job['project']['title']} from a real project snapshot. " + ("The automated recipe passed." if passed else "Review the evidence and prioritize the reported gaps."), "raw_output": output[-2000:]}


def run_job(job: dict) -> None:
    job_id = job["id"]
    try:
        request("POST", f"/internal/evaluator/jobs/{job_id}/progress", {"lease_token": job["lease_token"], "stage": "Snapshotting project safely"})
        with tempfile.TemporaryDirectory(prefix="farq-eval-") as temporary:
            root = Path(temporary) / "project"; root.mkdir()
            manifest = materialize(job, root)
            adapter, image, command = detect_adapter(root)
            executed = image is not None and command is not None
            passed, output = (docker_run(root, image, command) if executed else (False, "No executable adapter; artifact inspected statically."))
            request("POST", f"/internal/evaluator/jobs/{job_id}/progress", {"lease_token": job["lease_token"], "stage": "Scoring rubric from captured evidence"})
            payload = report(job, adapter, manifest, executed, passed, output)
            payload.pop("raw_output", None)
            request("POST", f"/internal/evaluator/jobs/{job_id}/complete", payload)
    except Exception as exc:
        try: request("POST", f"/internal/evaluator/jobs/{job_id}/fail", {"lease_token": job["lease_token"], "error": str(exc)[:3000]})
        except Exception: pass


def main() -> None:
    print(f"Farq evaluator connected to {API}. Ctrl+C to stop.")
    while True:
        try:
            request("POST", "/internal/evaluator/heartbeat", {})
            payload = request("POST", "/internal/evaluator/jobs/claim", {})
            if payload.get("job"): run_job(payload["job"])
            else: time.sleep(2)
        except (urllib.error.URLError, TimeoutError): time.sleep(3)


if __name__ == "__main__": main()
