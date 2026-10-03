"""Install evaluator browser using the existing local Node/npm runtime."""
from pathlib import Path
import subprocess
from evaluator_native import npm_command
root = Path(__file__).resolve().parents[1]
subprocess.run(npm_command() + ["exec", "--", "playwright", "install", "chromium"], cwd=root, check=True)
