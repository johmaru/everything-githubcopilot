#!/usr/bin/env bash
# cleanup-system.sh — Bash wrapper for the user-level installer CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_PATH="$REPO_ROOT/scripts/installer/cli.js"
PROVIDER="${1:-copilot}"

if [[ "$PROVIDER" != "copilot" && "$PROVIDER" != "codex" && "$PROVIDER" != "all" ]]; then
  echo "Usage: ./scripts/cleanup-system.sh [copilot|codex|all]" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but was not found in PATH." >&2
  exit 1
fi

if [ ! -f "$CLI_PATH" ]; then
  echo "Installer CLI not found: $CLI_PATH" >&2
  exit 1
fi

echo "Running user-level uninstaller --provider $PROVIDER"
node "$CLI_PATH" uninstall --provider "$PROVIDER"
