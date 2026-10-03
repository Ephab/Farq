#!/usr/bin/env python3
"""Waypoint one-command dev runner (macOS).

Starts FastAPI (:8000), Coach/email Q&A (:8642), and Vite (:5173).
Press Ctrl+C once and everything shuts down.

Usage:
    bash run.sh
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(REPO, ".env")
RUNTIME = os.path.join(REPO, ".hermes-runtime")

API_PORT = 8000
HERMES_PORT = 8642
WEB_PORT = 5173


def log(msg: str) -> None:
    print(f"[waypoint] {msg}", flush=True)


sys.path.insert(0, REPO)
from scripts.local_env import configure_env, read_env
from scripts.runtime import build_env, child_env, restart_targets, executable, hermes_command, provision, require_python
from pathlib import Path


def read_dotenv_values():
    return read_env(Path(ENV_FILE))


def load_env():
    os.environ.update(configure_env(Path(REPO)))


def ensure_venv():
    return require_python(Path(REPO))


def ensure_runtime():
    provision(Path(REPO), Path(RUNTIME))


def build_child_env(values):
    return build_env(values, Path(REPO), Path(RUNTIME))


def stream(name: str, proc: subprocess.Popen) -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        print(f"[{name}] {line.rstrip()}", flush=True)


def start(name: str, cmd: list[str], env: dict[str, str]) -> subprocess.Popen:
    env = child_env(name, env, Path(REPO))
    proc = subprocess.Popen(
        cmd, cwd=REPO, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    threading.Thread(target=stream, args=(name, proc), daemon=True).start()
    return proc


def wait_healthy(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(1)
    return False


def main() -> int:
    for name, url in (
        ("api", f"http://127.0.0.1:{API_PORT}/api/health"),
        ("hermes", f"http://127.0.0.1:{HERMES_PORT}/health"),
        ("web", f"http://127.0.0.1:{WEB_PORT}/"),
    ):
        try:
            with urllib.request.urlopen(url, timeout=2):
                pass
            log(f"ERROR: {name} already answers on its port — stop it first, then re-run.")
            return 1
        except Exception:
            pass

    load_env()
    if not shutil.which("npm"):
        log("ERROR: npm not found — install Node.js first.")
        return 1
    if not executable("hermes"):
        log("ERROR: hermes binary not found on PATH.")
        return 1
    hermes_cmd = hermes_command()
    if hermes_cmd is None:
        log("ERROR: the hermes launcher on PATH is broken (its managed Python is missing).")
        log("Repair the global install by re-running the official Hermes installer from your home")
        log("directory with a clean environment, then re-run run.sh. Nothing was modified.")
        return 1
    if hermes_cmd != [executable("hermes")]:
        log("hermes launcher is stale; starting the gateway through your install's own managed")
        log("Python instead (read-only — your base Hermes installation is untouched).")
    if not os.path.isdir(os.path.join(REPO, "node_modules")):
        log("Run setup.bat (Windows) or bash setup.sh (macOS) first.")
        return 1
    py = ensure_venv()
    ensure_runtime()

    commands = {
        "evaluator": [py, "-u", "scripts/evaluator_worker.py"],
        "api": [py, "-m", "uvicorn", "app.main:app", "--app-dir", "services/api",
                "--port", str(API_PORT), "--no-access-log"],
        # NOTE: `gateway run` stays in the foreground as our child, tied to
        # HERMES_HOME above. Bare `hermes gateway` would daemonize and escape
        # shutdown, so never use it here.
        "hermes": [*hermes_cmd, "gateway", "run"],
        "web": ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(WEB_PORT)],
    }
    # Only Waypoint's own children are ever restarted here. The daily-use base
    # Hermes profile is never touched: different HERMES_HOME, no stop/restart
    # commands against it.
    RESTARTABLE = ("api", "hermes", "evaluator")
    children: dict[str, subprocess.Popen] = {}
    pending_restart: set[str] = set()
    lock = threading.Lock()

    def spawn(name: str) -> None:
        children[name] = start(name, commands[name], build_child_env(read_dotenv_values()))

    def watch_env() -> None:
        """Restart api+hermes when Apply-in-Settings (or a hand edit) changes .env."""
        try:
            last = os.path.getmtime(ENV_FILE)
        except OSError:
            last = 0.0
        known = read_dotenv_values()
        while True:
            time.sleep(2)
            try:
                mtime = os.path.getmtime(ENV_FILE)
            except OSError:
                continue
            if mtime == last:
                continue
            time.sleep(1.5)  # debounce: let the atomic .env replace settle
            try:
                settled = os.path.getmtime(ENV_FILE)
            except OSError:
                continue
            if settled != mtime:
                last = settled
                continue
            last = mtime
            current = read_dotenv_values()
            targets = restart_targets(known, current, RESTARTABLE)
            known = current
            if not targets:
                continue
            log(f".env changed — restarting {'+'.join(targets)} with new settings ...")
            with lock:
                pending_restart.update(targets)
                victims = [(name, children.pop(name, None)) for name in targets]
            for _, proc in victims:
                if proc is not None and proc.poll() is None:
                    proc.terminate()
            for _, proc in victims:
                if proc is not None:
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            with lock:
                for name in targets:
                    try:
                        spawn(name)
                    except Exception as exc:
                        log(f"{name} failed to restart: {exc}")
                pending_restart.difference_update(targets)
            for name, url in (("api", f"http://127.0.0.1:{API_PORT}/api/health"), ("hermes", f"http://127.0.0.1:{HERMES_PORT}/health")):
                if name not in targets:
                    continue
                if wait_healthy(url, 20):
                    log(f"{name} restarted with new settings")
                else:
                    log(f"{name} did NOT come back — see [{name}] output above")

    with lock:
        for child_name in commands:
            spawn(child_name)
    threading.Thread(target=watch_env, daemon=True).start()

    ok = wait_healthy(f"http://127.0.0.1:{API_PORT}/api/health", 30)
    log(f"api    :{API_PORT} " + ("up" if ok else "DID NOT START — see [api] output"))
    ok = wait_healthy(f"http://127.0.0.1:{HERMES_PORT}/health", 30)
    log(f"hermes :{HERMES_PORT} " + ("up" if ok else "DID NOT START — see [hermes] output"))
    ok = wait_healthy(f"http://127.0.0.1:{WEB_PORT}/", 45)
    log(f"web    :{WEB_PORT} " + ("up" if ok else "DID NOT START — see [web] output"))

    print("\n  Site:  http://127.0.0.1:5173", flush=True)
    print("  API docs: http://127.0.0.1:8000/docs", flush=True)
    print("  Press Ctrl+C to shut everything down.\n", flush=True)

    stop = False

    def on_signal(_signum, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)
    while not stop:
        time.sleep(0.2)
        with lock:
            snapshot = list(children.items())
            restarting = set(pending_restart)
        for name, p in snapshot:
            if p.poll() is not None and name not in restarting:
                log(f"{name} exited (code {p.returncode}) — shutting down the rest.")
                stop = True
                break

    log("shutting down ...")
    with lock:
        remaining = list(children.values())
    for p in remaining:
        if p.poll() is None:
            p.terminate()
    for p in remaining:
        try:
            p.wait(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
    log("all stopped. Bye!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
