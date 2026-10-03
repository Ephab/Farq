"""Finite native evaluator actions. See docs/evaluator-threat-model.md."""
from __future__ import annotations
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def clean_env(home: Path) -> dict:
    home.mkdir(parents=True, exist_ok=True)
    env = {key: value for key, value in os.environ.items() if key.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP",
        "PROGRAMFILES", "PROGRAMFILES(X86)", "LANG", "LC_ALL",
    }}
    env.update(HOME=str(home), USERPROFILE=str(home), APPDATA=str(home), LOCALAPPDATA=str(home),
               npm_config_cache=str(home / "npm-cache"), CI="true", PYTHONIOENCODING="utf-8",
               PYTHONUTF8="1", TEST_DOCKER="0", WAYPOINT_EVALUATION="1")
    browser_cache = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "ms-playwright" if os.name == "nt" else Path.home() / ("Library/Caches/ms-playwright" if sys.platform == "darwin" else ".cache/ms-playwright")
    env["PLAYWRIGHT_BROWSERS_PATH"] = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", str(browser_cache))
    return env


def stop_process(proc):
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            try: os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        else:
            proc.kill()
        proc.wait()


def npm_command():
    node, npm = shutil.which("node"), shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("Node.js/npm missing; run setup first")
    path = Path(npm).resolve()
    cli = path.parent / "node_modules/npm/bin/npm-cli.js" if path.suffix.lower() == ".cmd" else path
    if not cli.is_file():
        raise RuntimeError("Cannot locate npm-cli.js; repair the Node.js installation")
    return [node, str(cli)]


class NativeSession:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.env = clean_env(root.parent / "runtime-home")
        self.server = None
        self.server_log = None
        self.origin = None
        self.screenshots = []
        self.deadline = time.monotonic() + 900
        self.python = None
        self.executed_checks = 0
        self.package = json.loads((root / "package.json").read_text(encoding="utf-8-sig")) if (root / "package.json").exists() else {}

    def file(self, entry):
        path = (self.root / entry).resolve()
        if not path.is_relative_to(self.root) or not path.is_file() or path.is_symlink():
            raise ValueError("Entry must be a regular file in the submitted snapshot")
        return path

    def script(self, name):
        script = self.package.get("scripts", {}).get(name)
        if not isinstance(script, str):
            raise ValueError("Only existing package.json scripts may be run")
        if re.search(r"\bdocker(?:\.exe)?\b", script, re.I):
            raise ValueError("Docker scripts are disabled in native evaluation")
        return npm_command() + ["run", name]

    def run(self, command, timeout=180):
        if time.monotonic() >= self.deadline:
            raise TimeoutError("Evaluation exceeded its 15-minute runtime budget")
        with tempfile.TemporaryFile() as log:
            self.executed_checks += 1
            proc = subprocess.Popen(command, cwd=self.root, env=self.env, stdin=subprocess.DEVNULL,
                                    stdout=log, stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
            try:
                proc.wait(timeout=min(timeout, max(1, self.deadline - time.monotonic())))
            except subprocess.TimeoutExpired:
                stop_process(proc)
                return False, "Check timed out; process tree stopped"
            finally:
                if proc.poll() is None:
                    stop_process(proc)
            log.seek(0, 2)
            log.seek(max(0, log.tell() - 15000))
            output = log.read().decode("utf-8", errors="replace")
        displayed = [str(item).replace(str(self.root), "<snapshot>") for item in command]
        return proc.returncode == 0, "Executed: " + json.dumps(displayed) + f"\nExit code: {proc.returncode}\n{output}"

    def local_url(self, path):
        if not self.origin:
            raise ValueError("Start the submitted app before HTTP/browser checks")
        if not path.startswith("/") or path.startswith("//") or "\\" in path or any(ord(c) < 32 for c in path):
            raise ValueError("Only relative paths on the launched app are allowed")
        return self.origin + path

    def execute(self, action):
        kind = action["kind"]
        args = action.get("args", [])
        if any(not isinstance(arg, str) or len(arg) > 500 or "\x00" in arg for arg in args):
            raise ValueError("Invalid action arguments")
        if kind == "run_script":
            return self.run(self.script(action["script"]) + (["--"] + args if args else []))
        if kind == "node_cli":
            entry = self.file(action["entry"])
            if entry.suffix.lower() not in {".js", ".mjs", ".cjs"}:
                raise ValueError("Node CLI requires a JS entry")
            node = shutil.which("node")
            if not node: raise RuntimeError("Node.js is missing")
            return self.run([node, str(entry), *args])
        if kind == "probe_harness":
            entry = self.file(action.get("entry") or "harness.js")
            return self.run([shutil.which("node") or "node", str(REPO / "scripts/evaluator_harness_probe.mjs"), str(entry)])
        if kind == "install_dependencies":
            if self.package:
                return self.run(npm_command() + ["ci" if (self.root / "package-lock.json").exists() else "install", "--ignore-scripts", "--no-audit", "--no-fund"], 300)
            return self.prepare_python()
        if kind == "python_tests":
            if not self.python:
                passed, output = self.prepare_python()
                if not passed: return passed, output
            passed, output = self.run([self.python, "-m", "pip", "install", "pytest"], 120)
            if not passed: return passed, output
            return self.run([self.python, "-m", "pytest", "-q"], 180)
        if kind == "start_server":
            if self.server:
                return False, "An app server is already running"
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
            self.origin = f"http://127.0.0.1:{port}"
            server_args = [arg.replace("PORT", str(port)) for arg in (args or ["--host", "127.0.0.1", "--port", "PORT"])]
            self.env.update(PORT=str(port), HOST="127.0.0.1", BROWSER="none")
            self.server_log = tempfile.TemporaryFile()
            self.server = subprocess.Popen(self.script(action["script"]) + ["--", *server_args], cwd=self.root,
                                           env=self.env, stdin=subprocess.DEVNULL, stdout=self.server_log,
                                           stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
            end = time.monotonic() + 45
            while time.monotonic() < end and self.server.poll() is None:
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                        return True, f"Submitted app is listening at {self.origin}"
                except OSError:
                    time.sleep(0.3)
            self.server_log.seek(0, 2); self.server_log.seek(max(0, self.server_log.tell() - 10000))
            return False, "App did not start on its assigned loopback port\n" + self.server_log.read().decode("utf-8", errors="replace")
        if kind == "http":
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args, **kwargs): return None
            data = json.dumps(action["body"]).encode() if action.get("body") is not None else None
            if data and len(data) > 16000: raise ValueError("Request body too large")
            req = urllib.request.Request(self.local_url(action.get("path", "/")), data=data,
                                         method=action.get("method", "GET"), headers={"Content-Type": "application/json"})
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            self.executed_checks += 1
            try:
                response = opener.open(req, timeout=15)
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                text = response.read(12000).decode("utf-8", errors="replace")
                passed = response.code == action.get("expected_status", 200) and action.get("expected_text", "") in text
                return passed, f"{req.method} {action.get('path', '/')} => HTTP {response.code}\n{text}"
        if kind == "browser":
            self.local_url(action.get("path", "/"))
            plan = {"origin": self.origin, "path": action.get("path", "/"), "steps": action.get("steps", []), "title": action["title"]}
            plan_path = self.root.parent / "browser-plan.json"
            output_path = self.root.parent / "browser-result.json"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            passed, output = self.run([shutil.which("node") or "node", str(REPO / "scripts/evaluator_browser.mjs"), str(plan_path), str(output_path)], 90)
            if output_path.exists():
                result = json.loads(output_path.read_text(encoding="utf-8"))
                for shot in result.pop("screenshots", []):
                    if len(self.screenshots) < 8:
                        self.screenshots.append({**shot, "id": f"shot-{len(self.screenshots)+1}"})
                output += "\n" + json.dumps(result, ensure_ascii=False)
            return passed, output[-15000:]
        raise ValueError("Unsupported evaluator action")

    def prepare_python(self):
        environment = self.root.parent / "python-env"
        passed, output = self.run([sys.executable, "-m", "venv", str(environment)], 90)
        if not passed: return passed, output
        self.python = str(environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
        if (self.root / "requirements.txt").exists():
            return self.run([self.python, "-m", "pip", "install", "-r", "requirements.txt"], 300)
        if (self.root / "pyproject.toml").exists():
            return self.run([self.python, "-m", "pip", "install", "."], 300)
        return True, "Private Python environment ready"

    def close(self):
        if self.server:
            stop_process(self.server)
        if self.server_log:
            self.server_log.close()
