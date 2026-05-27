#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir/.."

set -a
if [ -f ./.env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi
set +a

export RYANOS_CODEX_BRIDGE_HOST="${RYANOS_CODEX_BRIDGE_HOST:-0.0.0.0}"
export RYANOS_CODEX_COMMAND="${RYANOS_CODEX_COMMAND:-/Applications/Codex.app/Contents/Resources/codex}"
export RYANOS_NODE_COMMAND="${RYANOS_NODE_COMMAND:-node}"

exec "$RYANOS_NODE_COMMAND" packages/ai/dist/codex-bridge-server.js
