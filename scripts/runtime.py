"""Shared provisioning for Waypoint's shared Coach and email Hermes gateway."""
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PYTHON_VARS = {"VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "__PYVENV_LAUNCHER__"}
MAIL_SECRETS = {"WAYPOINT_TOKEN_ENCRYPTION_KEY", "OUTLOOK_LOCAL_TOKEN", "MICROSOFT_CLIENT_SECRET"}
PROVIDER_SECRETS = {"GEMINI_API_KEY", "NVIDIA_API_KEY", "HF_TOKEN", "HERMES_API_KEY", "API_SERVER_KEY", "WAYPOINT_INTERNAL_TOKEN"}

RETIRED_SKILLS = ("onboarding", "project-coach", "quiz", "slides", "student-coach", "team-coach")


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
    # Copies from before the Farq -> Waypoint rename would load beside the new plugin/skills.
    retired = [home / "plugins/farq"] + [home / "skills" / f"farq-{name}" for name in RETIRED_SKILLS]
    for stale in retired:
        if stale.exists() and stale.resolve().is_relative_to(home.resolve()):
            shutil.rmtree(stale)
    # Only refresh the project-owned subtree, after checking its resolved target.
    for source, target in [(root / ".hermes/plugins/waypoint", home / "plugins/waypoint")] + [
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
               WAYPOINT_API_INTERNAL_URL="http://127.0.0.1:8000", PYTHONIOENCODING="utf-8")
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


def _follow_shim(path: Path, hops: int = 5) -> Path:
    """Follow `exec <abs-path> "$@"` delegations to the real launcher script."""
    current = path
    for _ in range(hops):
        try:
            text = current.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return current
        lines = [line.strip() for line in text.splitlines()
                 if line.strip() and not line.strip().startswith("#")]
        if len(lines) == 1:
            match = re.fullmatch(r'exec\s+(\S+)\s+"\$@"', lines[0])
            if match:
                nxt = Path(match.group(1))
                if nxt.is_absolute() and nxt != current:
                    current = nxt
                    continue
        return current
    return current


def _split_shim_command(path: Path) -> tuple[str, str] | None:
    """Split a `exec <python> -I -c '<code>' "$@"` launcher into (python, code)."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    match = re.search(r"""^exec\s+(\S+)\s+-I\s+-c\s+'(.*)'\s+"\$@"\s*$""", text, re.M | re.S)
    if not match:
        return None
    # Undo the shell's '"'"' quoting to recover the real Python source.
    return match.group(1), match.group(2).replace("'\"'\"'", "'")


def _managed_pythons() -> list[Path]:
    """Executable managed Pythons from the user's own Hermes install.

    Read-only: Waypoint only ever runs this interpreter, never modifies it.
    """
    try:
        candidates = sorted((Path.home() / ".hermes" / "tools").glob("python-*/bin/python3*"))
    except OSError:
        return []
    return [item for item in candidates if item.is_file() and os.access(item, os.X_OK)]


def _probe(command: list[str], env: dict) -> bool:
    try:
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def hermes_command(root: Path = ROOT) -> list[str] | None:
    """Gateway launch command that survives a stale global Hermes shim.

    The installer-owned launcher sometimes bakes in a managed-Python path
    under a Hermes home that no longer ships that toolchain (exit 126 on
    every invocation). When the on-PATH shim works, it is used unchanged.
    Otherwise Waypoint reuses the shim's own bootstrap code verbatim with a
    working managed Python from the user's Hermes install — read-only, so
    the base installation is never modified. HERMES_HOME still points at
    the repo runtime, so the personal profile is never touched either.

    Returns the command prefix (caller appends ``["gateway", "run"]``),
    or None when no working launcher exists.
    """
    del root
    shim = executable("hermes")
    if shim is None:
        return None
    clean_env = {key: value for key, value in os.environ.items()
                 if key not in {"HERMES_HOME", *PYTHON_VARS}}
    if _probe([shim, "--version"], clean_env):
        return [shim]
    split = _split_shim_command(_follow_shim(Path(shim)))
    if split is None:
        return None
    baked, code = split
    if Path(baked).is_file():
        # Parseable shim with a present interpreter but a failing probe:
        # something else is wrong; do not guess further.
        return None
    wanted = Path(baked).parent.parent.name
    ordered = sorted(_managed_pythons(), key=lambda item: (item.parent.parent.name != wanted, item.name))
    for candidate in ordered:
        if _probe([str(candidate), "-I", "-c", code, "--version"], clean_env):
            return [str(candidate), "-I", "-c", code]
    return None
