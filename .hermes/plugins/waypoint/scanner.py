from __future__ import annotations

"""Deterministic, secret-safe folder indexing for onboarding.

Hermes runs on the student's machine, so these helpers read local folders the
student explicitly typed. The safety rules live here in code, not only in the
prompt: secret-like files are never opened, dependency/build trees are skipped,
and every read is bounded. A full threat model is still future work
(docs/future-work.md).
"""

import configparser
import json
import os
import re
import unicodedata
from collections import Counter
from pathlib import Path

MAX_ENTRIES = 4000          # files visited per scan
MAX_PROJECTS = 80
MAX_READ_BYTES = 20_000
MAX_OUTPUT_CHARS = 60_000

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env", ".env", ".tox", ".mypy_cache",
    ".pytest_cache", "dist", "build", "out", "bin", "obj", ".gradle", ".next", ".nuxt", ".angular",
    ".idea", ".vscode", "target", "site-packages", ".ipynb_checkpoints", ".cache", "coverage",
}
SECRET_NAME = re.compile(
    r"(^\.env(?!\.example$|\.sample$|\.template$)|secret|credential|password|passwd|\.pem$|\.key$|\.p12$|\.pfx$|"
    r"^id_(rsa|dsa|ecdsa|ed25519)|^appsettings.*\.json$|\.kdbx$|token|\.keystore$|\.jks$)",
    re.IGNORECASE,
)
IDENTITY_NAME = re.compile(r"(passport|national.?id|^id\.(pdf|jpe?g|png)$|iqama|driver.?licen[cs]e|birth.?cert)", re.IGNORECASE)
TEXT_EXT = {".md", ".txt", ".rst", ".json", ".toml", ".yaml", ".yml", ".cfg", ".ini", ".xml", ".gradle", ".kts", ".csproj", ".mod", ".py", ".ipynb"}
MANIFESTS = {
    "package.json", "requirements.txt", "pyproject.toml", "setup.py", "pom.xml", "build.gradle", "build.gradle.kts",
    "cargo.toml", "go.mod", "composer.json", "gemfile", "pubspec.yaml", "cmakelists.txt", "environment.yml",
}
DOMAIN_EXT = {
    ".sldprt": "cad", ".sldasm": "cad", ".step": "cad", ".stp": "cad", ".dwg": "cad", ".dxf": "cad", ".f3d": "cad",
    ".m": "matlab", ".slx": "simulink", ".ino": "arduino", ".kicad_pcb": "pcb", ".sch": "schematic", ".circ": "logisim",
    ".apkg": "anki", ".r": "r", ".sav": "spss", ".tex": "latex", ".psd": "design", ".ai": "design", ".fig": "design",
    ".ipynb": "notebook", ".sql": "sql",
}
MATERIAL_SYNONYMS = {
    "lecture": ["lecture", "lectures", "lecs", "lec", "theory", "theroy", "slides", "chapters"],
    "lab": ["lab", "labs", "labs_solved", "practical", "tutorial", "section"],
    "exam": ["exam", "exams", "olds", "midterm", "final", "finale", "past papers"],
    "quiz": ["quiz", "quizzes", "quizes", "quzzis"],
    "assignment": ["assignment", "assignments", "homework", "hw"],
    "project": ["project", "projects"],
}
TERM = re.compile(r"(\d+)\s*(st|nd|rd|th|d)\s*(semester|term|year)|(semester|term|year)\s*(\d+)|(fall|spring|summer|winter)\s*'?(\d{2,4})", re.IGNORECASE)
COURSE_CODE = re.compile(r"\b([A-Z]{2,4})[\s_-]?(\d{3})\b")


class ScanRefused(ValueError):
    pass


def is_secret(name: str) -> bool:
    return bool(SECRET_NAME.search(name))


def _is_venv(path: Path) -> bool:
    return (path / "pyvenv.cfg").exists()


def _norm(name: str) -> str:
    return unicodedata.normalize("NFC", name).replace("‎", "").replace("‏", "")


def _resolve(path: str) -> Path:
    root = Path(os.path.expanduser(path.strip().strip('"'))).resolve()
    if not root.exists() or not root.is_dir():
        raise ScanRefused(f"Folder not found: {path}")
    if root == Path(root.anchor):
        raise ScanRefused("Refusing to scan a whole drive; choose a specific folder")
    return root


def _walk(root: Path):
    """Yield (dirpath, dirnames, filenames) with dependency trees pruned."""
    for dirpath, dirnames, filenames in os.walk(root):
        current = Path(dirpath)
        dirnames[:] = [d for d in dirnames if d.lower() not in SKIP_DIRS and not d.startswith(".") and not _is_venv(current / d)]
        yield current, dirnames, filenames


def read_text_file(path: str, root: str | None = None) -> str:
    """Read a small text file, refusing secrets, identity documents and binaries."""
    target = Path(os.path.expanduser(path.strip().strip('"'))).resolve()
    if root is not None and not target.is_relative_to(Path(root).resolve()):
        raise ScanRefused("File is outside the scanned folder")
    if is_secret(target.name) or IDENTITY_NAME.search(target.name):
        raise ScanRefused("Refused: this file may contain secrets or personal identity data")
    if not target.is_file():
        raise ScanRefused(f"File not found: {path}")
    if target.suffix.lower() not in TEXT_EXT and target.name.lower() not in MANIFESTS and not target.name.lower().startswith("readme"):
        raise ScanRefused("Only README, manifest and small text files can be read")
    with target.open("rb") as handle:
        raw = handle.read(MAX_READ_BYTES)
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        text = raw.decode("utf-16", errors="replace")
    else:
        text = raw.decode("utf-8-sig", errors="replace")
    if target.suffix.lower() == ".ipynb":
        return _notebook_imports(text)
    return text


def _notebook_imports(text: str) -> str:
    imports = sorted(set(re.findall(r"(?:^|\\n|\")\s*(?:import|from)\s+([A-Za-z_][\w]*)", text)))
    return "Notebook imports: " + ", ".join(imports[:40])


def _git_info(project: Path) -> dict:
    git = project / ".git"
    if not git.is_dir():
        return {}
    info: dict = {}
    config = configparser.ConfigParser(strict=False)
    try:
        config.read(git / "config", encoding="utf-8")
        url = config.get('remote "origin"', "url", fallback="")
        # Never leak credentials embedded in remote URLs.
        info["remote"] = re.sub(r"//[^@/]+@", "//", url)
    except (configparser.Error, OSError):
        pass
    head_log = git / "logs" / "HEAD"
    if head_log.is_file():
        authors: Counter = Counter()
        try:
            with head_log.open("r", encoding="utf-8", errors="replace") as handle:
                for line in handle.readlines()[-500:]:
                    match = re.search(r"\s([^<>]+?)\s<([^>]*)>\s(\d+)", line)
                    if match and "commit" in line:
                        authors[match.group(2).lower()] += 1
        except OSError:
            pass
        if authors:
            info["local_commits_by_author"] = dict(authors.most_common(5))
    return info


def _manifest_summary(path: Path) -> dict:
    name = path.name.lower()
    try:
        text = read_text_file(str(path))
    except ScanRefused:
        return {}
    if name == "package.json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return {"file": name}
        deps = list((data.get("dependencies") or {}).keys()) + list((data.get("devDependencies") or {}).keys())
        return {"file": name, "name": data.get("name"), "deps": deps[:25]}
    if name in {"requirements.txt", "environment.yml"}:
        deps = [re.split(r"[=<>~\[; ]", line.strip())[0] for line in text.splitlines() if line.strip() and not line.startswith(("#", "-"))]
        return {"file": name, "deps": [d for d in deps if d][:25]}
    if name == "pyproject.toml":
        deps = re.findall(r'^\s*"([A-Za-z0-9_.-]+)', text, re.MULTILINE)
        return {"file": name, "deps": deps[:25]}
    if name.endswith(".csproj"):
        return {"file": name, "framework": re.findall(r"<TargetFramework>([^<]+)", text)[:1], "deps": re.findall(r'PackageReference Include="([^"]+)"', text)[:20]}
    return {"file": name}


def _readme_head(project: Path) -> str:
    for candidate in project.iterdir():
        if candidate.is_file() and candidate.name.lower().startswith("readme"):
            try:
                text = read_text_file(str(candidate))
            except ScanRefused:
                return ""
            text = re.sub(r"!\[[^\]]*\]\([^)]*\)|<[^>]+>", " ", text)
            return re.sub(r"\s+", " ", text).strip()[:400]
    return ""


def _looks_like_project(path: Path, filenames: list[str]) -> bool:
    lower = {name.lower() for name in filenames}
    return bool(lower & MANIFESTS) or (path / ".git").is_dir() or any(n.endswith(".csproj") or n.endswith(".sln") for n in lower) or any(n.startswith("readme") for n in lower)


def scan_projects(root: Path) -> dict:
    projects: list[dict] = []
    seen_remotes: set[str] = set()
    secrets_seen = 0
    visited = 0
    for current, dirnames, filenames in _walk(root):
        visited += len(filenames)
        secrets_seen += sum(1 for name in filenames if is_secret(name))
        if visited > MAX_ENTRIES or len(projects) >= MAX_PROJECTS:
            break
        if current == root or not _looks_like_project(current, filenames):
            continue
        git = _git_info(current)
        remote = git.get("remote", "").lower().removesuffix(".git")
        if remote and remote in seen_remotes:
            dirnames[:] = []
            continue
        if remote:
            seen_remotes.add(remote)
        extensions: Counter = Counter()
        newest = 0.0
        for sub, _dirs, files in _walk(current):
            for name in files[:400]:
                suffix = Path(name).suffix.lower()
                if suffix:
                    extensions[suffix] += 1
                try:
                    newest = max(newest, (sub / name).stat().st_mtime)
                except OSError:
                    pass
        manifests = [_manifest_summary(current / name) for name in filenames if name.lower() in MANIFESTS or name.lower().endswith(".csproj")]
        projects.append({
            "path": str(current.relative_to(root)),
            "name": _norm(current.name),
            "readme": _readme_head(current),
            "manifests": [m for m in manifests if m][:4],
            "git": git,
            "top_extensions": dict(extensions.most_common(8)),
            "domain_signals": sorted({DOMAIN_EXT[e] for e in extensions if e in DOMAIN_EXT}),
            "newest_file_epoch": int(newest),
        })
        dirnames[:] = []  # a project's subfolders belong to it
    return {"purpose": "projects", "root": str(root), "projects": projects, "secret_files_skipped": secrets_seen, "truncated": visited > MAX_ENTRIES}


def _material_type(parts: list[str]) -> str | None:
    for part in reversed(parts):
        lower = part.lower()
        for material, words in MATERIAL_SYNONYMS.items():
            if any(lower == w or lower.startswith(w + " ") for w in words):
                return material
    return None


def scan_coursework(root: Path) -> dict:
    """Blackboard stand-in: infer terms, courses and material types from paths."""
    courses: dict[str, dict] = {}
    flagged: list[str] = []
    visited = 0
    for current, dirnames, filenames in _walk(root):
        rel_parts = [_norm(p) for p in current.relative_to(root).parts]
        for name in filenames:
            visited += 1
            if visited > MAX_ENTRIES:
                break
            name = _norm(name)
            if is_secret(name) or IDENTITY_NAME.search(name):
                continue
            lower = name.lower()
            if re.search(r"transcript|tran_|grade report|academic record", lower):
                flagged.append(str(Path(*rel_parts, name)))
            term_part = next((p for p in rel_parts if TERM.search(p)), None)
            course_part = None
            if term_part is not None:
                index = rel_parts.index(term_part)
                course_part = rel_parts[index + 1] if index + 1 < len(rel_parts) else None
            elif rel_parts:
                course_part = rel_parts[0]
            if not course_part:
                continue
            key = f"{term_part or ''}/{course_part}"
            entry = courses.setdefault(key, {"course": course_part, "term": term_part or "", "codes": Counter(), "materials": Counter(), "files": 0, "domain_signals": set()})
            entry["files"] += 1
            for code in COURSE_CODE.findall(name.upper()):
                entry["codes"][f"{code[0]} {code[1]}"] += 1
            material = _material_type(rel_parts[rel_parts.index(course_part) + 1:] + [Path(name).stem])
            if material:
                entry["materials"][material] += 1
            suffix = Path(name).suffix.lower()
            if suffix in DOMAIN_EXT:
                entry["domain_signals"].add(DOMAIN_EXT[suffix])
        if visited > MAX_ENTRIES:
            break
    result = []
    for entry in courses.values():
        result.append({
            "course": entry["course"],
            "term": entry["term"],
            "likely_codes": [code for code, _ in entry["codes"].most_common(2)],
            "materials": dict(entry["materials"]),
            "files": entry["files"],
            "domain_signals": sorted(entry["domain_signals"]),
        })
    result.sort(key=lambda item: (item["term"], item["course"]))
    return {"purpose": "coursework", "root": str(root), "courses": result[:150], "transcript_like_files": flagged[:10], "truncated": visited > MAX_ENTRIES}


def scan_folder(path: str, purpose: str = "projects") -> str:
    try:
        root = _resolve(path)
        result = scan_coursework(root) if purpose == "coursework" else scan_projects(root)
    except ScanRefused as exc:
        return json.dumps({"success": False, "error": str(exc)})
    text = json.dumps(result, ensure_ascii=False)
    if len(text) > MAX_OUTPUT_CHARS:
        key = "courses" if purpose == "coursework" else "projects"
        while len(text) > MAX_OUTPUT_CHARS and result[key]:
            result[key] = result[key][: int(len(result[key]) * 0.8)]
            result["truncated"] = True
            text = json.dumps(result, ensure_ascii=False)
    return text


def read_project_file(path: str) -> str:
    try:
        return json.dumps({"success": True, "content": read_text_file(path)}, ensure_ascii=False)
    except ScanRefused as exc:
        return json.dumps({"success": False, "error": str(exc)})


EXT_LANGUAGE = {
    ".py": "Python", ".ipynb": "Jupyter", ".js": "JavaScript", ".jsx": "JavaScript", ".ts": "TypeScript", ".tsx": "TypeScript",
    ".java": "Java", ".kt": "Kotlin", ".cs": "C#", ".cpp": "C++", ".c": "C", ".go": "Go", ".rs": "Rust", ".rb": "Ruby",
    ".php": "PHP", ".swift": "Swift", ".dart": "Dart", ".sql": "SQL", ".r": "R", ".m": "MATLAB", ".ino": "Arduino",
    ".html": "HTML", ".css": "CSS", ".sh": "Shell", ".ps1": "PowerShell",
}


def _https_remote(remote: str) -> str:
    match = re.match(r"git@([^:]+):(.+)", remote)
    url = f"https://{match.group(1)}/{match.group(2)}" if match else remote
    return url.removesuffix(".git")


def evidence_from_scan(result: dict) -> list[dict]:
    """Deterministic manifest -> evidence mapping; the student reviews it afterwards."""
    items: list[dict] = []
    if result.get("purpose") == "coursework":
        for course in result.get("courses", []):
            if not course.get("term"):
                continue  # non-course folders (Important, COOP, …) are not courses
            data = {"term": course["term"], "materials": course.get("materials", {}), "files": course.get("files", 0)}
            if course.get("likely_codes"):
                data["code"] = course["likely_codes"][0]
            items.append({"kind": "course", "title": course["course"][:240], "data": data, "source_ref": f"{course['term']}/{course['course']}"[:500]})
        return items
    for project in result.get("projects", []):
        languages = []
        for ext, _count in sorted(project.get("top_extensions", {}).items(), key=lambda kv: -kv[1]):
            name = EXT_LANGUAGE.get(ext)
            if name and name not in languages:
                languages.append(name)
        deps = [dep for manifest in project.get("manifests", []) for dep in manifest.get("deps", [])]
        remote = _https_remote(project.get("git", {}).get("remote", ""))
        data = {
            "summary": project.get("readme", "")[:300],
            "languages": languages[:5],
            "frameworks": list(dict.fromkeys(deps))[:10],
            "domain_signals": project.get("domain_signals", []),
        }
        if remote:
            data["url"] = remote
        commits = project.get("git", {}).get("local_commits_by_author")
        if commits:
            data["local_commit_authors"] = commits
        if project.get("newest_file_epoch"):
            import datetime as _dt
            data["last_active"] = _dt.datetime.fromtimestamp(project["newest_file_epoch"]).strftime("%Y-%m-%d")
        item = {"kind": "project", "title": project["name"][:240], "data": data, "source_ref": project["path"][:500]}
        if remote:
            item["fingerprint"] = f"project:{remote.lower()}"
        items.append(item)
    return items


def index_folder(user_id: str, source_id: str, path: str, purpose: str, submit) -> str:
    """Scan + submit in one tool call so the model never has to rewrite the manifest."""
    raw = json.loads(scan_folder(path, purpose))
    if raw.get("success") is False:
        return json.dumps(raw)
    items = evidence_from_scan(raw)
    if not items:
        return json.dumps({"success": False, "error": "Nothing recognizable was found in this folder"})
    response = {}
    for start in range(0, len(items), 200):
        response = json.loads(submit({"user_id": user_id, "source_id": source_id, "items": items[start:start + 200]}))
        if response.get("success") is False:
            return json.dumps(response)
    return json.dumps({"success": True, "submitted": len(items), "kind": purpose, "truncated": raw.get("truncated", False),
                       "note": "Stored as suggestions for the student to review."})
