#!/bin/sh
set -eu
if [ "$(uname -s)" != "Darwin" ]; then
    echo "This installer is for macOS. Use setup.bat on Windows or Docker elsewhere." >&2
    exit 1
fi
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if command -v uv >/dev/null 2>&1; then
    UV=$(command -v uv)
elif [ -x "$HOME/.local/bin/uv" ]; then
    UV="$HOME/.local/bin/uv"
else
    echo 'Installing uv from astral.sh...'
    installer=$(mktemp)
    trap 'rm -f "$installer"' EXIT HUP INT TERM
    if command -v curl >/dev/null 2>&1; then
        curl --fail --location --proto '=https' --tlsv1.2 https://astral.sh/uv/0.12.18/install.sh -o "$installer"
    else
        wget -O "$installer" https://astral.sh/uv/0.12.18/install.sh
    fi
    sh "$installer"
    UV="$HOME/.local/bin/uv"
fi
"$UV" python install 3.12
"$UV" run --no-project --python 3.12 scripts/setup_local.py --uv "$UV" "$@"
