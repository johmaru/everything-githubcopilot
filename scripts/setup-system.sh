#!/usr/bin/env bash
# setup-system.sh — Bash wrapper for the user-level installer CLI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_PATH="$REPO_ROOT/scripts/installer/cli.js"
ACTION="${1:-install}"
PROVIDER="${2:-copilot}"

if [[ "$ACTION" != "install" && "$ACTION" != "uninstall" && "$ACTION" != "reinstall" ]]; then
  echo "Usage: ./scripts/setup-system.sh [install|uninstall|reinstall] [copilot|codex|all]" >&2
  exit 1
fi

if [[ "$PROVIDER" != "copilot" && "$PROVIDER" != "codex" && "$PROVIDER" != "all" ]]; then
  echo "Usage: ./scripts/setup-system.sh [install|uninstall|reinstall] [copilot|codex|all]" >&2
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

echo "Running user-level installer: $ACTION --provider $PROVIDER"
node "$CLI_PATH" "$ACTION" --provider "$PROVIDER"
