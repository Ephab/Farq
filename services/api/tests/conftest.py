import sys
from pathlib import Path

# Make `import app` work when pytest runs from the repo root (the documented command).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
