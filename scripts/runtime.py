"""Shared provisioning for Farq's shared Coach and email Hermes gateway."""
from pathlib import Path
import os
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VARS = {"VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "__PYVENV_LAUNCHER__"}
MAIL_SECRETS = {"FARQ_TOKEN_ENCRYPTION_KEY", "OUTLOOK_LOCAL_TOKEN", "MICROSOFT_CLIENT_SECRET"}
PROVIDER_SECRETS = {"GEMINI_API_KEY", "NVIDIA_API_KEY", "HF_TOKEN", "HERMES_API_KEY", "API_SERVER_KEY", "FARQ_INTERNAL_TOKEN"}


def executable(name: str) -> str | None:
    result = shutil.which(name)
    if result:
        return result
    if name == "hermes":
        candidates = [Path.home() / ".local/bin/hermes", Path.home() / ".hermes/hermes-agent/.venv/bin/hermes"]
        if os.name == "nt":
            candidates.insert(0, Path(os.getenv("LOCALAPPDATA", "")) / "hermes/bin/hermes.exe")
        return next((str(path) for path in candidates if path.is_file()), None)
    return None


def provision(root: Path = ROOT, runtime: Path | None = None):
    home = runtime or root / ".hermes-runtime"
    home.mkdir(parents=True, exist_ok=True)
    for filename in ("config.yaml", "SOUL.md"):
        shutil.copy2(root / "services/hermes" / filename, home / filename)
    # Only refresh the project-owned subtree, after checking its resolved target.
    for source, target in [(root / ".hermes/plugins/farq", home / "plugins/farq")] + [
        (skill, home / "skills" / skill.name) for skill in (root / ".hermes/skills").iterdir() if skill.is_dir()
    ]:
        if not target.resolve().is_relative_to(home.resolve()):
            raise RuntimeError("Runtime path escapes its configured home")
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)


def build_env(values, root: Path = ROOT, runtime: Path | None = None):
    env = dict(os.environ, **values)
    home = runtime or root / ".hermes-runtime"
    # Hermes keeps ONE host-wide gateway per OS user, locked outside HERMES_HOME
    # (~/.local/state/hermes/gateway-locks). Farq's own lock dir keeps its gateway from
    # attaching to, or being refused by, the user's personal Hermes gateway.
    env.update(HERMES_HOME=str(home), HERMES_GATEWAY_LOCK_DIR=str(home / "gateway-locks"),
               HERMES_ENABLE_PROJECT_PLUGINS="1",
               HERMES_URL="http://127.0.0.1:8642", API_SERVER_ENABLED="true", API_SERVER_HOST="127.0.0.1",
               API_SERVER_PORT="8642", API_SERVER_KEY=values["HERMES_API_KEY"],
               FARQ_API_INTERNAL_URL="http://127.0.0.1:8000", PYTHONIOENCODING="utf-8")
    return env


def child_env(name: str, env: dict, root: Path = ROOT):
    env = dict(env)
    if name != "api":
        for key in MAIL_SECRETS:
            env.pop(key, None)
    if name == "hermes":
        for key in PYTHON_VARS:
            env.pop(key, None)
    if name == "web":
        for key in PROVIDER_SECRETS:
            env.pop(key, None)
    return env


def require_python(root: Path = ROOT) -> str:
    path = root / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    if not path.is_file():
        raise RuntimeError("Run setup.bat (Windows) or bash setup.sh (macOS) first.")
    return str(path)
