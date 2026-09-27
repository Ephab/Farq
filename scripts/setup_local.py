"""Shared, standard-library-only installer used after uv bootstraps Python."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import platform
import re
import subprocess
import shutil
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.local_env import configure_env
from scripts.runtime import executable, provision


def torch_extra() -> str:
    if platform.system() == "Darwin":
        return "cpu"  # macOS PyPI wheel includes MPS; no CUDA index on macOS.
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=15, check=True)
    except (OSError, subprocess.SubprocessError):
        return "cpu"
    version = re.search(r"CUDA(?: UMD)? Version:\s*(\d+)\.(\d+)", result.stdout)
    if version and tuple(map(int, version.groups())) >= (12, 8):
        return "cuda"
    print("CUDA 12.8-compatible driver not detected; using CPU. Update the NVIDIA driver and rerun to enable CUDA.")
    return "cpu"


def ensure_hermes() -> str:
    command = executable("hermes")
    clean_env = {key: value for key, value in os.environ.items() if key not in {
        "HERMES_HOME", "VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "__PYVENV_LAUNCHER__"}}
    if command is None:
        suffix = ".ps1" if os.name == "nt" else ".sh"
        url = "https://hermes-agent.nousresearch.com/install" + suffix
        print("Installing Hermes from its official installer...", flush=True)
        with tempfile.TemporaryDirectory(prefix="waypoint-hermes-") as temporary:
            installer = Path(temporary) / ("install" + suffix)
            with urllib.request.urlopen(url, timeout=60) as response:
                installer.write_bytes(response.read())
            command_line = (["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(installer),
                             "-NonInteractive", "-SkipSetup", "-SkipComputerUse"] if os.name == "nt" else
                            ["bash", str(installer), "--non-interactive", "--skip-setup", "--skip-browser"])
            subprocess.run(command_line, env=clean_env, check=True)
        command = executable("hermes")
    if command is None:
        raise RuntimeError("Hermes installation finished but its CLI was not found. See https://hermes-agent.nousresearch.com/docs/getting-started/installation")
    subprocess.run([command, "--version"], env=clean_env, check=True, timeout=60)
    return command


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uv", default="uv")
    args = parser.parse_args()
    if platform.system() not in {"Windows", "Darwin"}:
        raise RuntimeError("Native setup supports Windows and macOS. Use Docker on other systems.")
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("Install Node.js LTS from https://nodejs.org, then rerun setup. Node.js/npm are required for the web app.")
    ensure_hermes()
    extra = torch_extra()
    print(f"Installing locked Python dependencies ({extra}; MPS detected at runtime on macOS)...", flush=True)
    subprocess.run([args.uv, "sync", "--locked", "--extra", extra], cwd=ROOT, check=True)
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    env = dict(os.environ, USE_TF="0", HF_HUB_DISABLE_TELEMETRY="1")
    # Setup may download; runtime never does. Respect HF_HOME for cache placement.
    env.pop("HF_HUB_OFFLINE", None)
    env.pop("TRANSFORMERS_OFFLINE", None)
    subprocess.run([str(python), "-m", "services.api.app.email_classifier", "--download", "--smoke-test"],
                   cwd=ROOT, env=env, check=True)
    subprocess.run([npm, "ci"], cwd=ROOT, check=True)
    values = configure_env(ROOT)
    provision(ROOT)
    print("Hermes and Laya verified. Web and Python dependencies installed; local credentials saved in .env.")
    print("Classic Outlook is ready for checkbox consent." if values.get("OUTLOOK_LOCAL_TOKEN") else
          "Classic Outlook is not installed/supported here; use the temporary Graph-token connection.")
    if not any(values.get(key) for key in ("GEMINI_API_KEY", "NVIDIA_API_KEY", "HF_TOKEN")):
        print("Add your AI provider key in .env to enable Hermes answers. Local email classification needs no cloud key.")
    print("Start the app with run.bat (Windows) or bash run.sh (macOS).")


if __name__ == "__main__":
    main()
