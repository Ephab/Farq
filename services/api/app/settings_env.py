from __future__ import annotations

"""Persist Settings-pane Hermes choices to the repo-root .env file.

Only the native runner (scripts/firas_run_mac.py) and the documented
PowerShell/Docker flows read this file, and only at process startup. After a
successful write the caller is responsible for restarting the Farq API and
gateway (the native runner watches .env and restarts its own isolated
children; other deployments need a manual restart).
"""

import os
from pathlib import Path

# services/api/app/settings_env.py -> parents[3] is the repo root.
ENV_PATH = Path(__file__).resolve().parents[3] / ".env"

MANAGED_KEYS = ("HERMES_API_KEY", "HERMES_MODEL", "HERMES_PROVIDER")


def read_env_values(path: Path = ENV_PATH) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return values
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env_values(updates: dict[str, str], path: Path = ENV_PATH) -> None:
    """Atomically rewrite .env, preserving comments, order, and other vars.

    Raises:
        FileNotFoundError: no .env to update (e.g. Docker-style env deployment).
        OSError: the file cannot be written.
    """
    if not path.exists():
        raise FileNotFoundError(f"No .env file at {path}")
    lines = path.read_text(encoding="utf-8").splitlines()
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            key, _ = stripped.split("=", 1)
            key = key.strip()
            if key in updates:
                out.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        out.append(line)
    for key in MANAGED_KEYS:
        if key in updates and key not in seen:
            out.append(f"{key}={updates[key]}")
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.replace(tmp, path)
