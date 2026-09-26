"""Shared, standard-library-only installer used after uv bootstraps Python."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import platform
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--uv", default="uv")
    args = parser.parse_args()
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
    print("Local email classifier ready. Dependencies are in .venv; model files are in the Hugging Face cache.")


if __name__ == "__main__":
    main()
