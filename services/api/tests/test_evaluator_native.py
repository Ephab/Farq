import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("native_worker", Path(__file__).resolve().parents[3] / "scripts/evaluator_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def test_native_inspection_never_executes_source(tmp_path):
    marker = tmp_path / "executed"
    (tmp_path / "project.py").write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
    passed, output = worker.native_inspect(tmp_path)
    assert passed
    assert not marker.exists()
    assert "No project code" in output


def test_native_inspection_reports_invalid_syntax(tmp_path):
    (tmp_path / "broken.py").write_text("def broken(")
    passed, output = worker.native_inspect(tmp_path)
    assert not passed
    assert "broken.py" in output


def test_node_package_with_windows_bom(tmp_path):
    (tmp_path / "package.json").write_text('{"scripts":{"test":"node --test"}}', encoding="utf-8-sig")
    assert worker.detect_adapter(tmp_path) == "software"
    assert worker.native_inspect(tmp_path)[0]


import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
from evaluator_native import NativeSession, clean_env
import json
import pytest


def test_native_child_environment_excludes_keys_and_docker(monkeypatch, tmp_path):
    monkeypatch.setenv("GEMINI_API_KEY", "test-secret")
    monkeypatch.setenv("WAYPOINT_INTERNAL_TOKEN", "test-token")
    monkeypatch.setenv("TEST_DOCKER", "1")
    env = clean_env(tmp_path / "home")
    assert "GEMINI_API_KEY" not in env
    assert "WAYPOINT_INTERNAL_TOKEN" not in env
    assert env["TEST_DOCKER"] == "0"


def test_native_cli_executes_snapshot_and_preserves_source_boundary(tmp_path):
    root = tmp_path / "project"; root.mkdir()
    (root / "entry.js").write_text('console.log("real runtime evidence")')
    session = NativeSession(root)
    try:
        passed, output = session.execute({"kind":"node_cli","entry":"entry.js"})
        assert passed and "real runtime evidence" in output
        with pytest.raises(ValueError): session.file("../outside.js")
    finally: session.close()


def test_native_actions_block_docker_scripts_and_other_local_origins(tmp_path):
    root = tmp_path / "project"; root.mkdir()
    (root / "package.json").write_text(json.dumps({"scripts":{"test":"docker run image"}}))
    session = NativeSession(root)
    with pytest.raises(ValueError, match="Docker"): session.script("test")
    session.origin = "http://127.0.0.1:54321"
    for path in ["http://127.0.0.1:8000/", "//127.0.0.1:8642/", "/\\evil"]:
        with pytest.raises(ValueError): session.local_url(path)


def test_native_timeout_stops_the_process(tmp_path):
    root = tmp_path / "project"; root.mkdir()
    (root / "slow.js").write_text('setInterval(()=>{},1000)')
    session = NativeSession(root)
    import shutil
    passed, output = session.run([shutil.which("node"), "slow.js"], timeout=0.2)
    assert not passed and "timed out" in output
