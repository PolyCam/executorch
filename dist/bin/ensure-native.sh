#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Homebrew PATH ─────────────────────────────────
if [[ -d /opt/homebrew/bin ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
elif [[ -d /usr/local/bin ]]; then
    export PATH="/usr/local/bin:$PATH"
fi

# ── Node Discovery (for Xcode/Gradle environments) ─────────────
# These environments often have limited PATH, so we need to find node

# Use NODE_BINARY if available (e.g., from .xcode.env.local)
if [[ -n "${NODE_BINARY:-}" ]] && [[ -x "$NODE_BINARY" ]]; then
    exec "$NODE_BINARY" "$SCRIPT_DIR/ensure-native.js" "$@"
fi

# Try PATH (now includes Homebrew)
if command -v node &> /dev/null; then
    exec node "$SCRIPT_DIR/ensure-native.js" "$@"
fi

# Homebrew paths (including versioned node like node@20, node@24)
for dir in /opt/homebrew/opt/node*/bin /usr/local/opt/node*/bin; do
    if [[ -d "$dir" ]] && [[ -x "$dir/node" ]]; then
        exec "$dir/node" "$SCRIPT_DIR/ensure-native.js" "$@"
    fi
done

# Standard paths
for dir in /opt/homebrew/bin /usr/local/bin /usr/bin; do
    if [[ -x "$dir/node" ]]; then
        exec "$dir/node" "$SCRIPT_DIR/ensure-native.js" "$@"
    fi
done

# nvm
if [[ -n "${HOME:-}" ]]; then
    for dir in "$HOME"/.nvm/versions/node/*/bin; do
        if [[ -d "$dir" ]] && [[ -x "$dir/node" ]]; then
            exec "$dir/node" "$SCRIPT_DIR/ensure-native.js" "$@"
        fi
    done
fi

echo "Error: Could not find node" >&2
exit 1
