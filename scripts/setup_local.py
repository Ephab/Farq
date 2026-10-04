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
                             # -NonInteractive also skips the setup/gateway-service stages.
                             "-NonInteractive", "-SkipBrowser"] if os.name == "nt" else
                            ["bash", str(installer), "--non-interactive", "--skip-setup", "--skip-browser"])
            subprocess.run(command_line, env=clean_env, check=True)
        command = executable("hermes")
    if command is None:
        raise RuntimeError("Hermes installation finished but its CLI was not found. See https://hermes-agent.nousresearch.com/docs/getting-started/installation")
    subprocess.run([command, "--version"], env=clean_env, check=True, timeout=60)
    return command


def ensure_chromium(python: Path) -> None:
    """Install only the headless shell Blackboard sync uses, and only if this Playwright lacks it."""
    dry_run = subprocess.run([str(python), "-m", "playwright", "install", "--dry-run", "--only-shell", "chromium"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
    locations = [Path(line.split(":", 1)[1].strip()) for line in dry_run.splitlines()
                 if line.strip().startswith("Install location:")]
    if locations and all(location.is_dir() and any(location.iterdir()) for location in locations):
        print("Headless Chromium already installed; skipping download.")
        return
    # Playwright also removes browser revisions no installed Playwright still uses.
    subprocess.run([str(python), "-m", "playwright", "install", "--only-shell", "chromium"], cwd=ROOT, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uv", default="uv")
    parser.add_argument("--with-laya", action="store_true",
                        help="Install torch and download the local Laya email classifier (~1-3 GB).")
    args = parser.parse_args()
    if platform.system() not in {"Windows", "Darwin"}:
        raise RuntimeError("Native setup supports Windows and macOS. Use Docker on other systems.")
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("Install Node.js LTS from https://nodejs.org, then rerun setup. Node.js/npm are required for the web app.")
    ensure_hermes()
    sync = [args.uv, "sync", "--locked"]
    if args.with_laya:
        extra = torch_extra()
        print(f"Installing locked Python dependencies with Laya ({extra}; MPS detected at runtime on macOS)...", flush=True)
        sync += ["--extra", extra]
    else:
        print("Installing locked Python dependencies (no local Laya; rerun setup with --with-laya to add it)...", flush=True)
    subprocess.run(sync, cwd=ROOT, check=True)
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    # Headless Chromium for the Blackboard sync (services/api/app/blackboard_sync/browser.py).
    ensure_chromium(python)
    if args.with_laya:
        env = dict(os.environ, USE_TF="0", HF_HUB_DISABLE_TELEMETRY="1")
        # Setup may download; runtime never does. Respect HF_HOME for cache placement.
        env.pop("HF_HUB_OFFLINE", None)
        env.pop("TRANSFORMERS_OFFLINE", None)
        subprocess.run([str(python), "-m", "services.api.app.email_classifier", "--download", "--smoke-test"],
                       cwd=ROOT, env=env, check=True)
    subprocess.run([npm, "ci"], cwd=ROOT, check=True)
    subprocess.run([str(python), "scripts/setup_evaluator.py"], cwd=ROOT, check=True)
    values = configure_env(ROOT)
    provision(ROOT)
    print(("Hermes and Laya verified." if args.with_laya else "Hermes verified.") + " Web and Python dependencies installed; local credentials saved in .env.")
    print("Classic Outlook is ready for checkbox consent." if values.get("OUTLOOK_LOCAL_TOKEN") else
          "Classic Outlook is not installed/supported here; use the temporary Graph-token connection.")
    if not any(values.get(key) for key in ("GEMINI_API_KEY", "NVIDIA_API_KEY", "HF_TOKEN")):
        print("Add your AI provider key in .env to enable Hermes answers. Local email classification needs no cloud key.")
    print("Start the app with run.bat (Windows) or bash run.sh (macOS).")


if __name__ == "__main__":
    main()
