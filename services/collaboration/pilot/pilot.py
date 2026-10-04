"""Run the Waypoint shared server on this PC behind one ngrok domain (Windows).

Use it through `server.bat` in the repository root:

    server.bat start --domain your-name.ngrok-free.dev     (the domain is remembered after the first time)
    server.bat start | status | stop | stop --all
    server.bat start --team-ai | --no-team-ai    (team Hermes on its own gateway, port 8643; remembered)

`start` brings up, in order: PostgreSQL (if it is not running), the database migrations, the collaboration service
(127.0.0.1:8100), the allowlisting proxy (pilot/proxy.py, 127.0.0.1:8200), the ngrok tunnel, and a small watchdog that
restarts any of them if it stops. Everything is launched detached, so closing the window or starting and quitting the
Waypoint app never touches it. `stop` ends the watchdog first, then the recorded processes, then clears the server's
ports. Run it from this service's folder with its own virtualenv (server.bat does that).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

import team_gateway

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parents[1] / ".cache" / "collaboration-native"
STATE = CACHE / "pilot.json"
PROXY_PORT = 8200
CENTRAL_PORT = 8100
POSTGRES_PORT = 55432
DOMAIN = re.compile(r"^(?=.{4,100}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")
HIDDEN = (subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == "nt" else 0
# Also leave the launcher's job object, if it allows it, so closing a terminal, a build tool or a shell session that
# started the server cannot take the server down with it.
BREAKAWAY = 0x01000000 if os.name == "nt" else 0


# --- state and processes ---------------------------------------------------------------------------

def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1))


def command_line(pid: int) -> str:
    result = subprocess.run(["powershell", "-NoProfile", "-Command",
                             f"(Get-CimInstance Win32_Process -Filter 'ProcessId={int(pid)}').CommandLine"],
                            capture_output=True, text=True, timeout=20)
    return result.stdout.strip()


def listener_pid(port: int) -> int | None:
    result = subprocess.run(["powershell", "-NoProfile", "-Command",
                             f"(Get-NetTCPConnection -LocalPort {int(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"],
                            capture_output=True, text=True, timeout=20)
    return int(result.stdout.strip()) if result.stdout.strip().isdigit() else None


def kill_tree(pid: int) -> None:
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)


def alive(pid: int) -> bool:
    out = subprocess.run(["tasklist", "/FI", f"PID eq {int(pid)}", "/NH"], capture_output=True, text=True, timeout=20).stdout
    return str(int(pid)) in out.split()


def listening(port: int) -> bool:
    import socket

    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def stop_listener(port: int, marker: str) -> None:
    """Stop whatever listens on `port`, but only if its command line contains `marker`."""
    pid = listener_pid(port)
    if pid is None:
        return
    line = command_line(pid)
    if marker not in line:
        raise SystemExit(f"Port {port} is used by another program ({line[:80]}); stop it yourself first")
    kill_tree(pid)
    time.sleep(1.5)


def launch(name: str, args: list, env: dict, marker: str, cwd: Path | None = None) -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    log = (CACHE / f"pilot-{name}.log").open("ab")
    command = [str(item) for item in args]
    try:
        process = subprocess.Popen(command, cwd=cwd or ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   creationflags=HIDDEN | BREAKAWAY, close_fds=True)
    except OSError:  # the surrounding job does not allow breakaway
        process = subprocess.Popen(command, cwd=cwd or ROOT, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                   creationflags=HIDDEN, close_fds=True)
    log.close()
    state = load_state()
    state.setdefault("processes", {})[name] = {"pid": process.pid, "marker": marker}
    save_state(state)
    return process.pid


def wait_for(url: str, check, seconds: int = 90, headers: dict | None = None) -> httpx.Response:
    deadline = time.monotonic() + seconds
    last = "no answer"
    while time.monotonic() < deadline:
        try:
            response = httpx.get(url, timeout=5, headers=headers or {}, follow_redirects=False)
            if check(response):
                return response
            last = f"HTTP {response.status_code}"
        except httpx.HTTPError as error:
            last = type(error).__name__
        time.sleep(2)
    raise SystemExit(f"Timed out waiting for {url} ({last})")


# --- the pieces of the server ------------------------------------------------------------------------

def postgres_up() -> bool:
    return listening(POSTGRES_PORT)


def ensure_postgres() -> None:
    """The shared server's own database, started here if it is not already running."""
    if postgres_up():
        return
    pg, data = CACHE / "postgres" / "pgsql" / "bin" / "pg_ctl.exe", CACHE / "pgdata"
    if not pg.exists() or not (data / "PG_VERSION").exists():
        # First run on this PC: download PostgreSQL (about 300 MB), create the database and start it.
        print("Setting up PostgreSQL for the first time (this downloads about 300 MB and takes a few minutes)")
        setup = subprocess.run([sys.executable, str(ROOT / "scripts" / "native_dev.py"), "start"], capture_output=True, text=True)
        if setup.returncode != 0:
            raise SystemExit("PostgreSQL setup failed:\n" + (setup.stderr or setup.stdout)[-600:])
    elif not postgres_up():
        print("Starting PostgreSQL")
        subprocess.run([str(pg), "-D", str(data), "-l", str(CACHE / "postgres.log"), "-w", "start"],
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=HIDDEN)
        # Never capture pipes here: the database server inherits them and would keep this call waiting until it exits.
    for _ in range(30):
        if postgres_up():
            return
        time.sleep(1)
    raise SystemExit("PostgreSQL did not start; see .cache/collaboration-native/postgres.log")


def web_origins() -> list[str]:
    """Where the app's web page runs on testers' computers; PILOT_ORIGINS adds more (comma separated, http://localhost only)."""
    extra = [item.strip() for item in os.getenv("PILOT_ORIGINS", "").split(",") if item.strip()]
    for item in extra:
        if not re.fullmatch(r"http://(localhost|127\.0\.0\.1):\d{2,5}", item):
            raise SystemExit(f"PILOT_ORIGINS entries must look like http://localhost:5174, not {item!r}")
    return ["http://localhost:5173", "http://127.0.0.1:5173", *extra]


def device_key(env_file: dict) -> str:
    """The server's signing key: COLLAB_DEVICE_SIGNING_KEY from .env if set, otherwise one created once in the cache folder."""
    if env_file.get("COLLAB_DEVICE_SIGNING_KEY"):
        return env_file["COLLAB_DEVICE_SIGNING_KEY"]
    path = CACHE / "device-signing.key"
    if not path.exists():
        import base64

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

        seed = Ed25519PrivateKey.generate().private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(base64.urlsafe_b64encode(seed).rstrip(b"=").decode())
    return path.read_text().strip()


def server_env() -> dict:
    env_file = {key: value for key, value in dotenv_values(ROOT / ".env").items() if value is not None}
    if not env_file.get("COLLAB_DATABASE_URL"):
        raise SystemExit("Run 'python scripts/init_dev.py' first; the server needs its local configuration")
    settings = os.environ | env_file | {"COLLAB_DEVICE_SIGNING_KEY": device_key(env_file), "COLLAB_ALLOWED_ORIGINS": json.dumps(web_origins()),
                                        "COLLAB_TEAMS_ENABLED": "true"}
    if load_state().get("team_ai"):
        settings |= team_gateway.service_settings()
    return settings


def start_central() -> None:
    stop_listener(CENTRAL_PORT, "collaboration.main:create_app")
    launch("central", [sys.executable, "-m", "uvicorn", "collaboration.main:create_app", "--factory", "--host", "127.0.0.1",
                       "--port", str(CENTRAL_PORT), "--timeout-graceful-shutdown", "3"], server_env(), "collaboration.main:create_app")


def start_team_hermes() -> None:
    """The shared server's own Hermes gateway (127.0.0.1:8643): own home, lock directory and tools, apart from any other Hermes."""
    stop_listener(team_gateway.PORT, "hermes")
    team_gateway.provision()
    command = team_gateway.find_hermes()
    if command is None:
        raise SystemExit("Team Hermes needs the `hermes` program installed on this PC")
    launch("team-hermes", [*command, "gateway", "run"], team_gateway.environment(CENTRAL_PORT), "hermes", cwd=team_gateway.HOME)
    first = not (team_gateway.HOME / "installs").exists()
    if first:
        print("Preparing team Hermes for the first time (its own isolated runtime; this can take several minutes)", flush=True)
    deadline = time.monotonic() + (900 if first else 120)
    while time.monotonic() < deadline and not listening(team_gateway.PORT):
        time.sleep(2)
    if not listening(team_gateway.PORT):
        raise SystemExit("Team Hermes did not start; see .cache/collaboration-native/pilot-team-hermes.log")


def start_proxy(domain: str) -> None:
    stop_listener(PROXY_PORT, "pilot")
    launch("proxy", [sys.executable, ROOT / "pilot" / "proxy.py"],
           os.environ | {"PILOT_PUBLIC_HOST": domain, "PILOT_PROXY_PORT": str(PROXY_PORT)}, "proxy.py")


def start_tunnel(domain: str) -> None:
    ngrok = shutil.which("ngrok")
    if not ngrok:
        raise SystemExit("ngrok was not found on PATH")
    old = load_state().get("processes", {}).get("ngrok")
    if old and "ngrok" in command_line(old["pid"]):
        kill_tree(old["pid"])
    launch("ngrok", [ngrok, "http", f"--url=https://{domain}", f"127.0.0.1:{PROXY_PORT}", "--log=stdout"], os.environ.copy(), "ngrok")


# --- the watchdog ------------------------------------------------------------------------------------

def stop_keeper() -> None:
    state = load_state()
    state.pop("keeper_token", None)  # the watchdog exits by itself when its token is gone
    old = state.get("processes", {}).pop("keeper", None)
    if old and old["marker"] in command_line(old["pid"]):
        kill_tree(old["pid"])
    save_state(state)


def keep() -> None:
    """Watchdog (runs detached, started by `start`): relaunch the database, service, proxy or tunnel if any of them stops.
    `stop` ends it first, and it exits by itself once it is no longer the recorded keeper."""
    token = os.environ.get("PILOT_KEEPER_TOKEN", "")
    log_path = CACHE / "pilot-keeper.log"

    def note(message: str) -> None:
        with log_path.open("a", encoding="utf-8") as handle:
            handle.write(time.strftime("%Y-%m-%d %H:%M:%S ") + message + "\n")

    note("watching")
    while True:
        state = load_state()
        domain = state.get("domain")
        if not token or state.get("keeper_token") != token or not domain:
            note("no longer the keeper; exiting")
            return
        try:
            if not postgres_up():
                note("PostgreSQL stopped; restarting it")
                ensure_postgres()
            if not listening(CENTRAL_PORT):
                note("service stopped; restarting it")
                start_central()
            if not listening(PROXY_PORT):
                note("proxy stopped; restarting it")
                start_proxy(domain)
            if state.get("team_ai") and not listening(team_gateway.PORT):
                note("team Hermes stopped; restarting it")
                start_team_hermes()
            tunnel = state.get("processes", {}).get("ngrok")
            if not tunnel or not alive(tunnel["pid"]):
                note("tunnel stopped; restarting it")
                start_tunnel(domain)
        except (Exception, SystemExit) as error:  # keep watching whatever happens
            note(f"could not restart something: {type(error).__name__}: {str(error)[:200]}")
        time.sleep(6)


# --- commands ----------------------------------------------------------------------------------------

def start(domain: str | None, team_ai: bool | None = None) -> None:
    domain = domain or os.getenv("PILOT_DOMAIN") or load_state().get("domain")
    if not domain:
        raise SystemExit("First start needs your domain: server.bat start --domain your-name.ngrok-free.dev (it is remembered afterwards)")
    if not DOMAIN.match(domain):
        raise SystemExit("Give the bare domain, for example your-name.ngrok-free.dev")
    if not shutil.which("ngrok"):
        raise SystemExit("ngrok was not found on PATH")
    public = f"https://{domain}"
    stop_keeper()  # a running watchdog would fight the restart below
    state = load_state()
    if team_ai is not None:
        state["team_ai"] = team_ai  # remembered, like the domain
    if state.get("team_ai"):
        possible, why = team_gateway.ready()
        if not possible:
            print(why + ". Starting without team Hermes.")
            state["team_ai"] = False
    save_state(state)
    env = server_env()
    ensure_postgres()
    migrated = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT, env=env, capture_output=True, text=True)
    if migrated.returncode != 0:
        raise SystemExit("Database migration failed:\n" + migrated.stderr[-600:])
    start_central()
    if load_state().get("team_ai"):
        start_team_hermes()
    start_proxy(domain)
    wait_for(f"http://127.0.0.1:{PROXY_PORT}/health/ready", lambda r: r.status_code == 200, seconds=60)
    start_tunnel(domain)
    token = secrets.token_hex(8)
    state = load_state()
    state.update(domain=domain, keeper_token=token)
    save_state(state)
    skip = {"ngrok-skip-browser-warning": "1"}
    wait_for(f"{public}/health/ready", lambda r: r.status_code == 200, seconds=60, headers=skip)
    # Over the public address only the intended endpoints may answer.
    expected = {"/v1/auth/pow": 200, "/v1/me": 401, "/admin/": 404, "/docs": 404, "/internal/hermes/x": 404}
    wrong = {path: httpx.get(public + path, timeout=10, headers=skip).status_code for path in expected}
    wrong = {path: code for path, code in wrong.items() if code != expected[path]}
    if wrong:
        raise SystemExit(f"Unexpected public responses {wrong}; stop with 'server.bat stop'")
    launch("keeper", [sys.executable, ROOT / "pilot" / "pilot.py", "keep"], os.environ | {"PILOT_KEEPER_TOKEN": token}, "pilot.py keep")
    print(f"\nThe shared server is online at {public}")
    print("Team Hermes (@hermes in project chat): " + ("on, on its own gateway at 127.0.0.1:8643" if load_state().get("team_ai") else "off (server.bat start --team-ai turns it on)"))
    print("It runs on its own: you can close this window and start, restart or quit the Waypoint app freely.")
    print("A small watchdog restarts any part of it that stops (log: .cache/collaboration-native/pilot-keeper.log).")
    print("Stop it with: server.bat stop\n")
    print("Anyone with the app puts this in their app's .env, restarts it, and opens Group Projects, which asks them once to confirm. Their shared account")
    print("and ID are created automatically; there is nothing to sign up for:")
    print(f"  WAYPOINT_COLLAB_URL={public}\n")


def stop(everything: bool = False) -> None:
    stop_keeper()
    state = load_state()
    for name, item in list(state.get("processes", {}).items()):
        if item["marker"] in command_line(item["pid"]):
            kill_tree(item["pid"])
            print(f"Stopped {name}")
        else:
            print(f"{name}: not running (recorded process {item['pid']} is gone or reused; left alone)")
    state["processes"] = {}
    save_state(state)
    # A piece the watchdog relaunched may not match its recorded PID any more; clear the server's own ports too.
    for port, marker in ((CENTRAL_PORT, "collaboration.main:create_app"), (PROXY_PORT, "pilot"), (team_gateway.PORT, "hermes")):
        try:
            stop_listener(port, marker)
        except SystemExit as error:
            print(error)
    if everything:
        pg, data = CACHE / "postgres" / "pgsql" / "bin" / "pg_ctl.exe", CACHE / "pgdata"
        if pg.exists() and (data / "postmaster.pid").exists():
            subprocess.run([str(pg), "-D", str(data), "-m", "fast", "-w", "stop"], capture_output=True, creationflags=HIDDEN)
            print("Stopped PostgreSQL")
    else:
        print("PostgreSQL was left running (use 'server.bat stop --all' to stop it too).")


def status() -> None:
    state = load_state()
    print(f"postgres  {'running' if postgres_up() else 'not running'}")
    for name, item in state.get("processes", {}).items():
        print(f"{name:9} pid {item['pid']:>6}  {'running' if item['marker'] in command_line(item['pid']) else 'not running'}")
    domain = state.get("domain")
    if domain:
        try:
            code = httpx.get(f"https://{domain}/health/ready", timeout=10, headers={"ngrok-skip-browser-warning": "1"}).status_code
        except httpx.HTTPError as error:
            code = type(error).__name__
        print(f"public    https://{domain}/health/ready -> {code}")
    else:
        print("The server has not been started")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    starter = sub.add_parser("start")
    starter.add_argument("--domain", help="your ngrok domain (needed once; remembered afterwards)")
    ai = starter.add_mutually_exclusive_group()
    ai.add_argument("--team-ai", dest="team_ai", action="store_true", default=None, help="turn on team Hermes (remembered)")
    ai.add_argument("--no-team-ai", dest="team_ai", action="store_false", help="turn team Hermes off (remembered)")
    sub.add_parser("stop").add_argument("--all", action="store_true", help="also stop PostgreSQL")
    sub.add_parser("status")
    sub.add_parser("keep")  # internal: the watchdog `start` launches
    args = parser.parse_args(argv)
    {"start": lambda: start(args.domain, args.team_ai), "stop": lambda: stop(args.all), "status": status, "keep": keep}[args.action]()


if __name__ == "__main__":
    main()
