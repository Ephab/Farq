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
PROVIDER_SECRETS = {"GEMINI_API_KEY", "NVIDIA_API_KEY", "HF_TOKEN", "OPENROUTER_API_KEY", "HERMES_API_KEY", "API_SERVER_KEY", "WAYPOINT_INTERNAL_TOKEN"}

# The Hermes gateway reads provider secrets and its own HERMES_*/API_SERVER_*/WAYPOINT_* settings;
# every other .env key (TypeSafe, Apify, Jev/Span tuning, ...) is read by the API alone. OPENROUTER_API_KEY
# is shared: Span decisions in the API, and the openrouter Hermes provider in the gateway.
GATEWAY_PREFIXES = ("HERMES_", "API_SERVER_", "WAYPOINT_")


def restart_targets(old: dict[str, str], new: dict[str, str], restartable=("api", "hermes")) -> tuple[str, ...]:
    """Which Waypoint children must restart after a .env change: the API always, the gateway only if it reads a changed key."""
    changed = {key for key in old.keys() | new.keys() if old.get(key) != new.get(key)}
    if not changed:
        return ()
    gateway = any(key in PROVIDER_SECRETS or key.startswith(GATEWAY_PREFIXES) for key in changed)
    return tuple(name for name in restartable if name != "hermes" or gateway)


RETIRED_SKILLS = ("onboarding", "project-coach", "quiz", "slides", "student-coach", "team-coach")
# Hermes seeds ~60 general skills (iMessage, Apple Notes, X, devops...) into a new home and lists every
# one in each run's system prompt. Waypoint exposes none of their tools, so the runtime opts out with
# this marker (Hermes then seeds only its essential `hermes-agent` skill) and provisioning drops the
# copies an earlier sync left behind.
NO_BUNDLED_SKILLS_MARKER = ".no-bundled-skills"
ESSENTIAL_SKILLS = {"hermes-agent"}


def prune_bundled_skills(skills: Path) -> list[str]:
    """Remove skill folders Hermes recorded in its bundled manifest; never Waypoint or learned skills."""
    manifest = skills / ".bundled_manifest"
    if not manifest.is_file():
        return []
    bundled = {line.split(":", 1)[0].strip() for line in manifest.read_text(encoding="utf-8").splitlines() if ":" in line}
    bundled -= ESSENTIAL_SKILLS
    removed = []
    for skill_md in sorted(skills.rglob("SKILL.md")):
        folder = skill_md.parent
        if folder.name in bundled and not folder.name.startswith("waypoint-") and folder.exists():
            if folder.resolve().is_relative_to(skills.resolve()):
                shutil.rmtree(folder)
                removed.append(folder.name)
    # Category folders (apple/, creative/, ...) left with no skill inside are leftovers too.
    for category in sorted(path for path in skills.iterdir() if path.is_dir() and not path.name.startswith(".")):
        if not category.name.startswith("waypoint-") and not any(category.rglob("SKILL.md")):
            shutil.rmtree(category)
    return removed


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
    (home / NO_BUNDLED_SKILLS_MARKER).write_text("Waypoint runtime: bundled Hermes skills are not used.\n", encoding="utf-8")
    if (home / "skills").is_dir():
        prune_bundled_skills(home / "skills")
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
