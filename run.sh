#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -x .venv/bin/python ]; then
    echo 'Run bash setup.sh first.' >&2
    exit 1
fi
exec .venv/bin/python scripts/run_mac.py
