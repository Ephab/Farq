"""The shared server's own Hermes gateway for team runs (`@hermes` in project chat). Windows host tooling for pilot.py.

It never shares anything with a personal or student Hermes: its own HERMES_HOME under .cache, its own gateway lock
directory, its own port (8643), only the waypoint-team plugin, no memory and no skills. It reuses the already
installed `hermes` program read-only. Its default model is OpenRouter's Space Bunny Alpha (the host's
OPENROUTER_API_KEY from the repository's `.env`); the host's GEMINI_API_KEY, if set, serves the fallback ladder.
The service never sees either key.
"""
from __future__ import annotations

import os
import secrets
import shutil
import subprocess
from pathlib import Path

from dotenv import dotenv_values

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent
REPO = SERVICE.parents[1]
CACHE = REPO / ".cache" / "collaboration-native"
BASE = CACHE / "team-hermes"
HOME = BASE / "home"
SECRETS = BASE / "secrets.env"
PORT = 8643
URL = f"http://127.0.0.1:{PORT}"
# Not inherited from this shell: anything addressed to another Hermes, the student app or the service.
STRIP_PREFIXES = ("HERMES_", "API_SERVER_", "WAYPOINT_", "COLLAB_", "GEMINI_", "OPENROUTER_", "NVIDIA_", "HF_")
STRIP_EXACT = {"VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "__PYVENV_LAUNCHER__"}


def tokens() -> dict[str, str]:
    """The gateway key and the tool token, made once and kept in the ignored cache (never printed)."""
    values = {key: value for key, value in dotenv_values(SECRETS).items() if value} if SECRETS.exists() else {}
    if len(values.get("API_KEY", "")) < 16 or len(values.get("TOOL_TOKEN", "")) < 32:
        values = {"API_KEY": secrets.token_urlsafe(24), "TOOL_TOKEN": secrets.token_urlsafe(40)}
        BASE.mkdir(parents=True, exist_ok=True)
        SECRETS.write_text("".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8")
    return values


def provider_key(name: str = "GEMINI_API_KEY") -> str | None:
    return (dotenv_values(REPO / ".env").get(name) or os.getenv(name) or "").strip() or None


def service_settings() -> dict[str, str]:
    """What the shared service needs to turn team Hermes on and talk to this gateway."""
    values = tokens()
    return {"COLLAB_TEAM_AI_ENABLED": "true", "COLLAB_HERMES_URL": URL,
            "COLLAB_HERMES_API_KEY": values["API_KEY"], "COLLAB_HERMES_TOOL_TOKEN": values["TOOL_TOKEN"]}


def find_hermes() -> list[str] | None:
    """The installed `hermes` launcher, or the repository's repair logic when a stale launcher needs it."""
    clean = {key: value for key, value in os.environ.items() if key not in STRIP_EXACT and key != "HERMES_HOME"}
    candidates = [shutil.which("hermes"), str(Path(os.getenv("LOCALAPPDATA", "")) / "hermes" / "bin" / "hermes.exe")]
    for path in candidates:
        if path and Path(path).is_file():
            try:
                if subprocess.run([path, "--version"], env=clean, capture_output=True, timeout=60).returncode == 0:
                    return [path]
            except (OSError, subprocess.TimeoutExpired):
                pass
    runtime = REPO / "scripts" / "runtime.py"
    if runtime.is_file():
        import importlib.util
        spec = importlib.util.spec_from_file_location("waypoint_runtime", runtime)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.hermes_command()
    return None


def provision() -> None:
    """Refresh this gateway's home from the project files (only paths under HOME are touched)."""
    HOME.mkdir(parents=True, exist_ok=True)
    for name in ("config.yaml", "SOUL.md"):
        shutil.copy2(HERE / "team-hermes" / name, HOME / name)
    (HOME / ".no-bundled-skills").write_text("Waypoint team gateway: bundled Hermes skills are not used.\n", encoding="utf-8")
    target = HOME / "plugins" / "waypoint-team"
    if not target.resolve().is_relative_to(HOME.resolve()):
        raise RuntimeError("Gateway path escapes its home")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(REPO / ".hermes" / "plugins" / "waypoint-team", target)


def environment(central_port: int) -> dict[str, str]:
    values = tokens()
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith(STRIP_PREFIXES) and key not in STRIP_EXACT}
    env.update(HERMES_HOME=str(HOME), HERMES_GATEWAY_LOCK_DIR=str(HOME / "gateway-locks"), HERMES_ENABLE_PROJECT_PLUGINS="1",
               API_SERVER_ENABLED="true", API_SERVER_HOST="127.0.0.1", API_SERVER_PORT=str(PORT), API_SERVER_KEY=values["API_KEY"],
               WAYPOINT_COLLAB_TOOL_TOKEN=values["TOOL_TOKEN"], WAYPOINT_COLLAB_INTERNAL_URL=f"http://127.0.0.1:{central_port}",
               GEMINI_API_KEY=provider_key() or "", OPENROUTER_API_KEY=provider_key("OPENROUTER_API_KEY") or "",
               PYTHONIOENCODING="utf-8")
    return env


def ready() -> tuple[bool, str]:
    """Can team Hermes be started on this PC? (message when it cannot)"""
    if not provider_key("OPENROUTER_API_KEY"):
        return False, "Team Hermes needs OPENROUTER_API_KEY in the repository's .env (the host's own key)"
    if find_hermes() is None:
        return False, "Team Hermes needs the `hermes` program installed on this PC"
    return True, ""
