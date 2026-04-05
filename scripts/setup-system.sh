#!/usr/bin/env bash
# setup-system.sh — Bash wrapper for the user-level installer CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_PATH="$REPO_ROOT/scripts/installer/cli.js"
ACTION="${1:-install}"

if [[ "$ACTION" != "install" && "$ACTION" != "reinstall" ]]; then
  echo "Usage: ./scripts/setup-system.sh [install|reinstall]" >&2
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

echo "Running user-level installer: $ACTION"
node "$CLI_PATH" "$ACTION"