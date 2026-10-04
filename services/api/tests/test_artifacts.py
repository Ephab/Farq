"""The two release artifacts: allowlisted contents, and an inspector that catches tampering."""
import importlib.util
import json
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("artifacts", ROOT / "scripts" / "artifacts.py")
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("artifacts")
    return {kind: artifacts.build(kind, out) for kind in ("student", "central")}


def names(path):
    with zipfile.ZipFile(path) as archive:
        return {name for name in archive.namelist() if name != artifacts.MANIFEST}


def test_real_artifacts_are_clean(built):
    assert artifacts.inspect(built["central"], "central") == []
    assert artifacts.inspect(built["student"], "student") == []


def test_central_artifact_is_only_the_service_and_team_toolset(built):
    central = names(built["central"])
    assert {"services/collaboration/collaboration/main.py", ".hermes/plugins/waypoint-team/__init__.py",
            ".hermes/skills/waypoint-team-coach/SKILL.md", "services/collaboration/Dockerfile"} <= central
    assert not [n for n in central if n.startswith(("services/api/", "src/", "packages/", "services/hermes/", ".hermes/plugins/waypoint/"))]
    assert not [n for n in central if n.startswith(".hermes/skills/") and "waypoint-team-coach" not in n]
    assert not [n for n in central if "/tests/" in n or n.endswith((".db", ".env")) or "/dev/" in n or "/pilot/" in n]


def test_student_artifact_has_no_central_service_or_team_toolset(built):
    student = names(built["student"])
    assert "services/api/app/main.py" in student and "packages/collaboration-auth/pyproject.toml" in student
    assert not [n for n in student if n.startswith("services/collaboration/") or "waypoint-team/" in n or n == "server.bat"]
    assert not [n for n in student if n.endswith((".db", ".sqlite")) or n.split("/")[-1] == ".env" or ".venv/" in n]


def test_builds_are_reproducible(built, tmp_path):
    again = artifacts.build("central", tmp_path)
    assert again.read_bytes() == built["central"].read_bytes()


def mutate(source: Path, target: Path, add=None, replace=None, drop=()):
    with zipfile.ZipFile(source) as old, zipfile.ZipFile(target, "w") as new:
        for item in old.infolist():
            if item.filename in drop:
                continue
            data = old.read(item.filename)
            if replace and item.filename in replace:
                data = replace[item.filename]
            new.writestr(item.filename, data)
        for name, data in (add or {}).items():
            new.writestr(name, data)
    return target


def manifest_with(source: Path, add: dict[str, bytes]):
    """An archive whose manifest honestly lists the extra files, so only content rules can object."""
    with zipfile.ZipFile(source) as old:
        manifest = json.loads(old.read(artifacts.MANIFEST))
    import hashlib
    for name, data in add.items():
        manifest["files"][name] = hashlib.sha256(data).hexdigest()
    return {artifacts.MANIFEST: json.dumps(manifest).encode(), **add}


@pytest.mark.parametrize("extra,kind,expected", [
    ({"services/api/app/main.py": b"x = 1\n"}, "central", "personal/student file"),
    ({"src/App.tsx": b"x"}, "central", "personal/student file"),
    ({"packages/collaboration-auth/pyproject.toml": b"x"}, "central", "personal/student file"),
    ({".hermes/skills/waypoint-mail-assistant/SKILL.md": b"x"}, "central", "personal skill"),
    ({"services/collaboration/.env": b"COLLAB_X=1"}, "central", "forbidden file"),
    ({"services/collaboration/state.db": b"x"}, "central", "forbidden file"),
    ({"services/collaboration/collaboration/leak.py": b"from app.models import Student\n"}, "central", "imports personal code"),
    ({"services/collaboration/collaboration/leak2.py": b"import waypoint_collaboration_auth\n"}, "central", "imports personal code"),
    ({"services/collaboration/README.md": b"-----BEGIN RSA PRIVATE KEY-----\n"}, "central", "secret-shaped"),
    ({"services/collaboration/notes.md": b"postgresql+psycopg://waypoint:hunter22@db/x"}, "central", "secret-shaped"),
    ({"services/collaboration/collaboration/x.py": b"y"}, "student", "central-only file"),
    ({".hermes/plugins/waypoint-team/x.py": b"y"}, "student", "central-only file"),
    ({"docs/key.txt": b"AIza" + b"A" * 35}, "student", "secret-shaped"),
    ({".env": b"WAYPOINT_INTERNAL_TOKEN=abc"}, "student", "forbidden file"),
])
def test_inspector_flags_forbidden_content(built, tmp_path, extra, kind, expected):
    path = mutate(built[kind], tmp_path / "bad.zip", add=manifest_with(built[kind], extra))
    assert any(expected in finding for finding in artifacts.inspect(path, kind)), artifacts.inspect(path, kind)


def test_inspector_flags_tampering_missing_files_and_wrong_kind(built, tmp_path):
    changed = mutate(built["central"], tmp_path / "t.zip", replace={"services/collaboration/collaboration/main.py": b"# changed\n"})
    assert any("hash mismatch" in f for f in artifacts.inspect(changed, "central"))
    unlisted = mutate(built["central"], tmp_path / "u.zip", add={"services/collaboration/extra.py": b"x=1\n"})
    assert any("manifest and archive contents differ" in f for f in artifacts.inspect(unlisted, "central"))
    assert any("missing MANIFEST" in f for f in artifacts.inspect(mutate(built["central"], tmp_path / "m.zip", drop=(artifacts.MANIFEST,)), "central"))
    assert any("manifest says" in f for f in artifacts.inspect(built["central"], "student"))
    manifest = json.loads(zipfile.ZipFile(built["central"]).read(artifacts.MANIFEST))
    manifest["files"].pop("services/collaboration/Dockerfile")
    trimmed = mutate(built["central"], tmp_path / "r.zip", drop=("services/collaboration/Dockerfile",),
                     replace={artifacts.MANIFEST: json.dumps(manifest).encode()})
    assert any("missing required file: services/collaboration/Dockerfile" in f for f in artifacts.inspect(trimmed, "central"))
