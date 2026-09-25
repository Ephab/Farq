#!/usr/bin/env python3
"""Farq one-command dev runner (Windows).

Starts FastAPI (:8000) + Hermes gateway (:8642) + Vite (:5173).
Press Ctrl+C once and everything shuts down.

Usage:
    py scripts\\run_windows.py

Windows port of firas_run_mac.py. Differences that matter:
- Each service runs in its own Job Object with KILL_ON_JOB_CLOSE, so stopping a
  service (or this runner dying for any reason, window close included) takes its
  whole process tree with it: npm -> cmd -> node, hermes.exe -> python.
- Services get their own process group, so only this runner sees Ctrl+C and
  npm never asks "Terminate batch job (Y/N)?".
- Hermes starts without the Farq venv's Python variables (see scripts/dev.ps1).
"""
from __future__ import annotations

import ctypes
import os
import secrets
import shutil
import signal
import socket
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

# Hermes has its own Python runtime. Inheriting these from the Farq venv can make
# its launcher load the wrong interpreter's extensions.
HERMES_STRIPPED_VARS = ("VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "__PYVENV_LAUNCHER__")

STOP = threading.Event()
# Health probes must never go through a system proxy from the Windows registry.
_LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def log(msg: str) -> None:
    print(f"[farq] {msg}", flush=True)


def read_dotenv_values() -> dict[str, str]:
    values: dict[str, str] = {}
    if not os.path.exists(ENV_FILE):
        return values
    # utf-8-sig: tolerate a BOM left by PowerShell's Out-File.
    with open(ENV_FILE, encoding="utf-8-sig") as f:
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
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        for k, v in values.items():
            f.write(f"{k}={v}\n")
    os.environ.update(values)
    if not os.environ["GEMINI_API_KEY"]:
        log("WARNING: GEMINI_API_KEY is empty — chat will fail until you set it in .env")


def ensure_venv() -> str:
    venv = os.path.join(REPO, ".venv")
    py = os.path.join(venv, "Scripts", "python.exe")
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
            shutil.copytree(src, dst, dirs_exist_ok=True)
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
        # Python children otherwise write the ANSI code page into our pipes.
        "PYTHONIOENCODING": "utf-8",
    })
    return env


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in (
        "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
        "ReadTransferCount", "WriteTransferCount", "OtherTransferCount",
    )]


class _BasicLimits(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", ctypes.c_uint32),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", ctypes.c_uint32),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", ctypes.c_uint32),
        ("SchedulingClass", ctypes.c_uint32),
    ]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimits),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class Job:
    """Windows job object whose processes (and their descendants) die when it closes."""

    _EXTENDED_LIMIT_INFORMATION = 9
    _KILL_ON_JOB_CLOSE = 0x2000

    def __init__(self) -> None:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = ctypes.c_void_p
        k32.CreateJobObjectW.argtypes = (ctypes.c_void_p, ctypes.c_wchar_p)
        k32.SetInformationJobObject.argtypes = (
            ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32)
        k32.AssignProcessToJobObject.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
        k32.TerminateJobObject.argtypes = (ctypes.c_void_p, ctypes.c_uint)
        k32.CloseHandle.argtypes = (ctypes.c_void_p,)
        self._k32 = k32
        self._handle = k32.CreateJobObjectW(None, None)
        if not self._handle:
            raise ctypes.WinError(ctypes.get_last_error())
        info = _ExtendedLimits()
        info.BasicLimitInformation.LimitFlags = self._KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(
                self._handle, self._EXTENDED_LIMIT_INFORMATION,
                ctypes.byref(info), ctypes.sizeof(info)):
            error = ctypes.WinError(ctypes.get_last_error())
            self.close()
            raise error

    def adopt(self, proc: subprocess.Popen) -> None:
        if not self._k32.AssignProcessToJobObject(self._handle, int(proc._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

    def close(self) -> None:
        if self._handle:
            self._k32.TerminateJobObject(self._handle, 1)
            self._k32.CloseHandle(self._handle)
            self._handle = None


class Service:
    """One started child process plus whatever it takes to stop its whole tree."""

    def __init__(self, name: str, cmd: list[str], env: dict[str, str]) -> None:
        self.proc = subprocess.Popen(
            cmd, cwd=REPO, env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            encoding="utf-8", errors="replace",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        self.job: Job | None = None
        try:
            job = Job()
            try:
                job.adopt(self.proc)
            except OSError:
                job.close()
                raise
            self.job = job
        except OSError as exc:
            log(f"{name}: no job object ({exc}); falling back to taskkill on shutdown")
        threading.Thread(target=stream, args=(name, self.proc), daemon=True).start()

    def stop(self) -> None:
        if self.job is not None:
            self.job.close()
        elif self.proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def stream(name: str, proc: subprocess.Popen) -> None:
    assert proc.stdout is not None
    for line in proc.stdout:
        print(f"[{name}] {line.rstrip()}", flush=True)


def port_in_use(port: int) -> bool:
    # A short connect beats an HTTP probe: Windows takes ~2 s to refuse a closed
    # localhost port, while a listener accepts instantly.
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def wait_healthy(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and not STOP.is_set():
        try:
            with _LOCAL.open(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(1)
    return False


def enable_console_colors() -> None:
    """Vite always emits ANSI colors on Windows; classic conhost only renders them in VT mode."""
    k32 = ctypes.WinDLL("kernel32")
    k32.GetStdHandle.restype = ctypes.c_void_p
    k32.GetConsoleMode.argtypes = (ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32))
    k32.SetConsoleMode.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
    handle = k32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
    mode = ctypes.c_uint32()
    if k32.GetConsoleMode(handle, ctypes.byref(mode)):  # false when stdout is redirected
        k32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING


def main() -> int:
    if os.name != "nt":
        log("ERROR: this runner is for Windows — use scripts/firas_run_mac.py instead.")
        return 1
    sys.stdout.reconfigure(errors="replace")
    enable_console_colors()

    for name, port in (("api", API_PORT), ("hermes", HERMES_PORT), ("web", WEB_PORT)):
        if port_in_use(port):
            log(f"ERROR: {name} port {port} is already in use — stop it first, then re-run.")
            return 1

    load_env()
    npm = shutil.which("npm")
    if not npm:
        log("ERROR: npm not found — install Node.js first.")
        return 1
    hermes = shutil.which("hermes")
    if not hermes:
        log("ERROR: hermes binary not found on PATH.")
        return 1
    if not os.path.isdir(os.path.join(REPO, "node_modules")):
        log("running npm install ...")
        subprocess.run([npm, "install"], check=True, cwd=REPO)
    py = ensure_venv()
    ensure_runtime()

    commands = {
        "api": [py, "-m", "uvicorn", "app.main:app", "--app-dir", "services/api",
                "--port", str(API_PORT)],
        # NOTE: `gateway run` stays in the foreground as our child, tied to
        # HERMES_HOME above. Bare `hermes gateway` would daemonize and escape
        # shutdown, so never use it here.
        "hermes": [hermes, "gateway", "run"],
        # npm resolves to npm.cmd; Popen needs its full path to run it.
        "web": [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", str(WEB_PORT)],
    }
    # Only Farq's own children are ever restarted here. The daily-use base
    # Hermes profile is never touched: different HERMES_HOME, no stop/restart
    # commands against it.
    RESTARTABLE = ("api", "hermes")
    children: dict[str, Service] = {}
    pending_restart: set[str] = set()
    lock = threading.Lock()

    def spawn(name: str) -> None:
        env = build_child_env(read_dotenv_values())
        if name == "hermes":
            for var in HERMES_STRIPPED_VARS:
                env.pop(var, None)
        children[name] = Service(name, commands[name], env)

    def watch_env() -> None:
        """Restart api+hermes when Apply-in-Settings (or a hand edit) changes .env."""
        try:
            last = os.path.getmtime(ENV_FILE)
        except OSError:
            last = 0.0
        while not STOP.is_set():
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
                if STOP.is_set():
                    return
                pending_restart.update(RESTARTABLE)
                victims = [children.pop(name, None) for name in RESTARTABLE]
            for service in victims:
                if service is not None:
                    service.stop()
            with lock:
                # Shutdown may have started while we were stopping; never
                # spawn a child the main thread will not clean up.
                if STOP.is_set():
                    return
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

    # Handlers go in before any child exists, so Ctrl+C during startup still
    # reaches the cleanup below instead of orphaning half-started services.
    def on_signal(_signum, _frame):
        STOP.set()

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGBREAK, on_signal)

    try:
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

        if not STOP.is_set():
            print("\n  Site:  http://127.0.0.1:5173", flush=True)
            print("  API docs: http://127.0.0.1:8000/docs", flush=True)
            print("  Press Ctrl+C to shut everything down.\n", flush=True)

        while not STOP.is_set():
            time.sleep(0.2)
            with lock:
                snapshot = list(children.items())
                restarting = set(pending_restart)
            for name, service in snapshot:
                if service.proc.poll() is not None and name not in restarting:
                    log(f"{name} exited (code {service.proc.returncode}) — shutting down the rest.")
                    STOP.set()
                    break
    finally:
        STOP.set()
        log("shutting down ...")
        with lock:
            remaining = list(children.values())
        for service in remaining:
            service.stop()
        log("all stopped. Bye!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
