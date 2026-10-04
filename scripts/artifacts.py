"""Build and inspect the two release artifacts: the student app and the central collaboration deployment.

    python scripts/artifacts.py build student --out dist-artifacts
    python scripts/artifacts.py build central --out dist-artifacts
    python scripts/artifacts.py inspect dist-artifacts/waypoint-central.zip --kind central

Each artifact is an allowlist applied to the files git knows about (tracked or untracked, not ignored), so
local databases, `.env` files and virtualenvs cannot ride along. `inspect` re-checks a finished zip against
its own manifest hashes, the forbidden-path rules for its kind, required files, personal-code imports in the
central source and secret-shaped content. CI should build, inspect and fail on any finding.
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "MANIFEST.json"
FIXED_TIME = (2026, 1, 1, 0, 0, 0)

# Never in any artifact.
ALWAYS_EXCLUDE = (
    ".git/*", ".claude/*", ".cache/*", ".venv/*", "*/.venv/*", "node_modules/*", "*/node_modules/*", "dist-artifacts/*",
    ".hermes-runtime/*", "*.db", "*.db-shm", "*.db-wal", "*.sqlite*", "*__pycache__/*", "*.pyc", ".pytest_cache/*", "*/.pytest_cache/*",
    ".env", "*/.env", ".env.*", "*/.env.*", "*.log", "*.pid", "*.dump",
)
ENV_EXAMPLES = (".env.example", "services/collaboration/.env.example")

STUDENT_EXCLUDE = ("services/collaboration/*", ".hermes/plugins/waypoint-team/*", "docs/superpowers/*", "server.bat")

CENTRAL_INCLUDE = ("services/collaboration/*", ".hermes/plugins/waypoint-team/*", ".hermes/skills/waypoint-team-coach/*")
CENTRAL_EXCLUDE = (
    "services/collaboration/tests/*", "services/collaboration/scripts/native_dev.py", "services/collaboration/scripts/init_dev.py",
    "services/collaboration/pilot/*",
)
CENTRAL_REQUIRED = (
    "services/collaboration/collaboration/main.py", "services/collaboration/alembic.ini", "services/collaboration/pyproject.toml",
    "services/collaboration/uv.lock", "services/collaboration/Dockerfile", "services/collaboration/scripts/backup.py",
    ".hermes/plugins/waypoint-team/__init__.py", ".hermes/skills/waypoint-team-coach/SKILL.md",
)
# What a central image must never contain: personal backend, UI, desktop login, personal plugin/skills/memory.
CENTRAL_FORBIDDEN = (
    "services/api/*", "src/*", "packages/collaboration-auth/*", ".hermes/plugins/waypoint/*", "services/hermes/*",
    "scripts/run_*.py", "scripts/setup_*", "setup.*", "run.*",
)
CENTRAL_ALLOWED_SKILL = ".hermes/skills/waypoint-team-coach/"
PERSONAL_IMPORT = re.compile(r"^\s*(?:from|import)\s+(?:app\b|services\.api|waypoint_collaboration_auth)", re.MULTILINE)

SECRETS = (
    re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(rb"AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(rb"\bsk-[A-Za-z0-9]{20,}"),
    re.compile(rb"\bnvapi-[A-Za-z0-9_\-]{20,}"),
    re.compile(rb"postgres(?:ql)?(?:\+\w+)?://[^:\s/@]+:(?!replace-me|password|\*+)[^@\s]{4,}@"),
)


def matches(path: str, patterns) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def repo_files(root: Path = ROOT) -> list[str]:
    result = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=root, check=True, capture_output=True)
    return sorted(name for name in result.stdout.decode("utf-8").split("\0") if name and (root / name).is_file())


def select(kind: str, files: list[str]) -> list[str]:
    chosen = []
    for path in files:
        if matches(path, ALWAYS_EXCLUDE) and path not in ENV_EXAMPLES:
            continue
        if kind == "student":
            if matches(path, STUDENT_EXCLUDE):
                continue
        elif kind == "central":
            if not matches(path, CENTRAL_INCLUDE) or matches(path, CENTRAL_EXCLUDE):
                continue
        else:
            raise ValueError(f"Unknown artifact kind {kind}")
        chosen.append(path)
    return chosen


def build(kind: str, out: Path, root: Path = ROOT, files: list[str] | None = None) -> Path:
    chosen = select(kind, repo_files(root) if files is None else files)
    manifest = {"kind": kind, "files": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in chosen}}
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"waypoint-{kind}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in [*chosen]:
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type, info.external_attr = zipfile.ZIP_DEFLATED, 0o644 << 16
            archive.writestr(info, (root / name).read_bytes())
        info = zipfile.ZipInfo(MANIFEST, FIXED_TIME)
        archive.writestr(info, json.dumps(manifest, indent=1, sort_keys=True))
    return target


def inspect(archive_path: Path, kind: str) -> list[str]:
    """Findings (empty means clean)."""
    findings: list[str] = []
    with zipfile.ZipFile(archive_path) as archive:
        names = [name for name in archive.namelist() if name != MANIFEST]
        try:
            manifest = json.loads(archive.read(MANIFEST))
        except KeyError:
            return ["missing MANIFEST.json"]
        if manifest.get("kind") != kind:
            findings.append(f"manifest says {manifest.get('kind')!r}, expected {kind!r}")
        listed = manifest.get("files", {})
        if set(listed) != set(names):
            findings.append("manifest and archive contents differ: " + ", ".join(sorted(set(listed) ^ set(names))[:5]))
        for name in names:
            data = archive.read(name)
            if listed.get(name) != hashlib.sha256(data).hexdigest():
                findings.append(f"hash mismatch: {name}")
            if matches(name, ALWAYS_EXCLUDE) and name not in ENV_EXAMPLES:
                findings.append(f"forbidden file: {name}")
            if kind == "student" and (matches(name, STUDENT_EXCLUDE)):
                findings.append(f"central-only file in student artifact: {name}")
            if kind == "central":
                if matches(name, CENTRAL_FORBIDDEN):
                    findings.append(f"personal/student file in central artifact: {name}")
                if name.startswith(".hermes/skills/") and not name.startswith(CENTRAL_ALLOWED_SKILL):
                    findings.append(f"personal skill in central artifact: {name}")
                if name.startswith("services/collaboration/collaboration/") and name.endswith(".py") \
                        and PERSONAL_IMPORT.search(data.decode("utf-8", errors="replace")):
                    findings.append(f"central code imports personal code: {name}")
            for pattern in () if "/tests/" in "/" + name else SECRETS:  # fixtures hold deliberate fake secrets
                if pattern.search(data):
                    findings.append(f"secret-shaped content: {name}")
                    break
        if kind == "central":
            findings += [f"missing required file: {name}" for name in CENTRAL_REQUIRED if name not in names]
        if kind == "student" and not any(name == "services/api/app/main.py" for name in names):
            findings.append("missing required file: services/api/app/main.py")
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    building = sub.add_parser("build")
    building.add_argument("kind", choices=("student", "central"))
    building.add_argument("--out", type=Path, default=ROOT / "dist-artifacts")
    inspecting = sub.add_parser("inspect")
    inspecting.add_argument("archive", type=Path)
    inspecting.add_argument("--kind", choices=("student", "central"), required=True)
    args = parser.parse_args(argv)
    if args.action == "build":
        target = build(args.kind, args.out)
        findings = inspect(target, args.kind)
    else:
        target, findings = args.archive, inspect(args.archive, args.kind)
    for finding in findings:
        print("FINDING:", finding, file=sys.stderr)
    print(f"{target}: {'FAILED' if findings else 'clean'}")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
