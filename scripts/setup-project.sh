#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_PATH="$REPO_ROOT/scripts/installer/project-setup.js"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required to run setup-project." >&2
  exit 1
fi

node "$CLI_PATH" "$@"