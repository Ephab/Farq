#!/usr/bin/env python3
"""Farq one-command dev runner (macOS/Linux).

Starts FastAPI (:8000) + Hermes gateway (:8642) + Vite (:5173).
Press Ctrl+C once and everything shuts down.

Usage:
    python3 scripts/run.py
"""
from __future__ import annotations

import os
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(REPO, ".env")
ENV_EXAMPLE = os.path.join(REPO, ".env.example")
RUNTIME = os.path.join(REPO, ".hermes-runtime")

API_PORT = 8000
HERMES_PORT = 8642
WEB_PORT = 5173


def log(msg: str) -> None:
    print(f"[farq] {msg}", flush=True)


def read_dotenv_values() -> dict[str, str]:
    values: dict[str, str] = {}
    if not os.path.exists(ENV_FILE):
        return values
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                values[k.strip()] = v.strip()
    return values


def load_env() -> None:
    if not os.path.exists(ENV_FILE):
        if os.path.exists(ENV_EXAMPLE):
            shutil.copy(ENV_EXAMPLE, ENV_FILE)
            log("created .env from .env.example")
        else:
            open(ENV_FILE, "a").close()
    values: dict[str, str] = read_dotenv_values()
    if len(values.get("HERMES_API_KEY", "")) < 32:
        values["HERMES_API_KEY"] = secrets.token_hex(32)
        log("generated HERMES_API_KEY")
    values.setdefault("GEMINI_API_KEY", "")
    values.setdefault("HERMES_MODEL", "gemini-2.5-flash")
    values.setdefault("HERMES_PROVIDER", "gemini")
    values.setdefault("FARQ_INTERNAL_TOKEN", "farq-internal-dev")
    with open(ENV_FILE, "w") as f:
        for k, v in values.items():
            f.write(f"{k}={v}\n")
    os.environ.update(values)
    if not os.environ["GEMINI_API_KEY"]:
        log("WARNING: GEMINI_API_KEY is empty — chat will fail until you set it in .env")


def ensure_venv() -> str:
    venv = os.path.join(REPO, ".venv")
    py = os.path.join(venv, "bin", "python")
    if not os.path.exists(py):
        log("creating .venv ...")
        subprocess.run([sys.executable, "-m", "venv", venv], check=True, cwd=REPO)
    marker = os.path.join(venv, ".farq-deps")
    req = os.path.join(REPO, "services", "api", "requirements.txt")
    if not os.path.exists(marker) or os.path.getmtime(req) > os.path.getmtime(marker):
        log("installing backend deps ...")
        subprocess.run([py, "-m", "pip", "install", "-q", "-r", req], check=True, cwd=REPO)
        open(marker, "w").close()
    return py


def ensure_runtime() -> None:
    def sync(src: str, dst: str) -> None:
        if os.path.isdir(src):
            shutil.rmtree(dst, ignore_errors=True)
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)

    os.makedirs(os.path.join(RUNTIME, "plugins", "farq"), exist_ok=True)
    sync(os.path.join(REPO, "services", "hermes", "config.yaml"), os.path.join(RUNTIME, "config.yaml"))
    sync(os.path.join(REPO, "services", "hermes", "SOUL.md"), os.path.join(RUNTIME, "SOUL.md"))
    sync(os.path.join(REPO, ".hermes", "plugins", "farq"), os.path.join(RUNTIME, "plugins", "farq"))
    for skill in os.scandir(os.path.join(REPO, ".hermes", "skills")):
        if skill.is_dir():
            sync(skill.path, os.path.join(RUNTIME, "skills", skill.name))


def build_child_env(values: dict[str, str]) -> dict[str, str]:
    """Fresh child env from .env values so Apply-in-Settings restarts pick up new keys."""
    env = dict(os.environ)
    env.update(values)
    env.update({
        "HERMES_API_KEY": values["HERMES_API_KEY"],
        "HERMES_MODEL": values.get("HERMES_MODEL", "gemini-2.5-flash"),
        "HERMES_PROVIDER": values.get("HERMES_PROVIDER", "gemini"),
        "HERMES_URL": f"http://127.0.0.1:{HERMES_PORT}",
        "CORS_ORIGINS": "http://localhost:5173,http://127.0.0.1:5173",
        "HERMES_ENABLE_PROJECT_PLUGINS": "1",
        "HERMES_HOME": RUNTIME,
        "API_SERVER_ENABLED": "true",
        "API_SERVER_HOST": "127.0.0.1",
        "API_SERVER_PORT": str(HERMES_PORT),
        "FARQ_API_INTERNAL_URL": f"http://127.0.0.1:{API_PORT}",
        "FARQ_INTERNAL_TOKEN": values.get("FARQ_INTERNAL_TOKEN", "farq-internal-dev"),
        "API_SERVER_KEY": values["HERMES_API_KEY"],
    })
    return env


def stream(name: str, proc: subprocess.Popen) -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        print(f"[{name}] {line.rstrip()}", flush=True)


def start(name: str, cmd: list[str], env: dict[str, str]) -> subprocess.Popen:
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
    if not shutil.which("hermes"):
        log("ERROR: hermes binary not found on PATH.")
        return 1
    if not os.path.isdir(os.path.join(REPO, "node_modules")):
        log("running npm install ...")
        subprocess.run(["npm", "install"], check=True, cwd=REPO)
    py = ensure_venv()
    ensure_runtime()

    commands = {
        "api": [py, "-m", "uvicorn", "app.main:app", "--app-dir", "services/api",
                "--port", str(API_PORT)],
        # NOTE: `gateway run` stays in the foreground as our child, tied to
        # HERMES_HOME above. Bare `hermes gateway` would daemonize and escape
        # shutdown, so never use it here.
        "hermes": ["hermes", "gateway", "run"],
        "web": ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(WEB_PORT)],
    }
    # Only Farq's own children are ever restarted here. The daily-use base
    # Hermes profile is never touched: different HERMES_HOME, no stop/restart
    # commands against it.
    RESTARTABLE = ("api", "hermes")
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
            log(".env changed — restarting api+hermes with new settings ...")
            with lock:
                pending_restart.update(RESTARTABLE)
                victims = [(name, children.pop(name, None)) for name in RESTARTABLE]
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
                for name in RESTARTABLE:
                    try:
                        spawn(name)
                    except Exception as exc:
                        log(f"{name} failed to restart: {exc}")
                pending_restart.difference_update(RESTARTABLE)
            if wait_healthy(f"http://127.0.0.1:{API_PORT}/api/health", 20):
                log("api restarted with new settings")
            else:
                log("api did NOT come back — see [api] output above")
            if wait_healthy(f"http://127.0.0.1:{HERMES_PORT}/health", 20):
                log("hermes restarted with new settings")
            else:
                log("hermes did NOT come back — see [hermes] output above")

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
