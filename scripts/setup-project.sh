#!/usr/bin/env bash
# setup-project.sh — Install Copilot customizations into a target project.
#
# Usage:
#   ./scripts/setup-project.sh /path/to/your-project
#   ./scripts/setup-project.sh                          # targets parent of this repo
#
# Typical bootstrap workflow:
#   cd /path/to/your-project
#   git clone https://github.com/johmaru/everything-githubcopilot.git
#   cd everything-githubcopilot
#   ./scripts/setup-project.sh
#
# Copies .github/ Copilot assets and .vscode/settings.json into the target
# project so VS Code discovers instructions, prompts, agents, hooks, and skills.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_TARGET="$(dirname "$REPO_ROOT")"
TARGET="${1:-$DEFAULT_TARGET}"
TARGET="$(cd "$TARGET" 2>/dev/null && pwd)" || { echo "Error: directory '$1' does not exist."; exit 1; }

if [ "$TARGET" = "$REPO_ROOT" ]; then
  echo "Error: target is the same as the source repository."
  exit 1
fi

echo "Source:  $REPO_ROOT"
echo "Target:  $TARGET"
echo ""

# --- .github/ Copilot assets ---
GITHUB_DIR="$TARGET/.github"
mkdir -p "$GITHUB_DIR"

# copilot-instructions.md
cp "$REPO_ROOT/.github/copilot-instructions.md" "$GITHUB_DIR/copilot-instructions.md"
echo "  Copied  .github/copilot-instructions.md"

# instructions/
if [ -d "$REPO_ROOT/.github/instructions" ]; then
  mkdir -p "$GITHUB_DIR/instructions"
  find "$REPO_ROOT/.github/instructions" -maxdepth 1 -name '*.instructions.md' -exec cp {} "$GITHUB_DIR/instructions/" \;
  echo "  Copied  .github/instructions/ ($(find "$GITHUB_DIR/instructions" -name '*.instructions.md' | wc -l | tr -d ' ') files)"
fi

# prompts/
if [ -d "$REPO_ROOT/.github/prompts" ]; then
  mkdir -p "$GITHUB_DIR/prompts"
  cp "$REPO_ROOT/.github/prompts/"*.prompt.md "$GITHUB_DIR/prompts/" 2>/dev/null || true
  echo "  Copied  .github/prompts/ ($(find "$GITHUB_DIR/prompts" -name '*.prompt.md' | wc -l | tr -d ' ') files)"
fi

# agents/
if [ -d "$REPO_ROOT/.github/agents" ]; then
  mkdir -p "$GITHUB_DIR/agents"
  cp "$REPO_ROOT/.github/agents/"*.agent.md "$GITHUB_DIR/agents/" 2>/dev/null || true
  echo "  Copied  .github/agents/ ($(find "$GITHUB_DIR/agents" -name '*.agent.md' | wc -l | tr -d ' ') files)"
fi

# hooks/
if [ -d "$REPO_ROOT/.github/hooks" ]; then
  mkdir -p "$GITHUB_DIR/hooks"
  cp "$REPO_ROOT/.github/hooks/"*.json "$GITHUB_DIR/hooks/" 2>/dev/null || true
  echo "  Copied  .github/hooks/"
fi

if [ -d "$REPO_ROOT/scripts/hooks" ]; then
  mkdir -p "$TARGET/scripts/hooks"
  cp "$REPO_ROOT/scripts/hooks/"*.js "$TARGET/scripts/hooks/" 2>/dev/null || true
  echo "  Copied  scripts/hooks/"
fi

# skills/
if [ -d "$REPO_ROOT/.github/skills" ]; then
  cp -r "$REPO_ROOT/.github/skills" "$GITHUB_DIR/skills"
  echo "  Copied  .github/skills/ ($(find "$GITHUB_DIR/skills" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') skills)"
fi

# workflows/ (optional — only if target has no existing workflows)
if [ -d "$REPO_ROOT/.github/workflows" ] && [ ! -d "$GITHUB_DIR/workflows" ]; then
  cp -r "$REPO_ROOT/.github/workflows" "$GITHUB_DIR/workflows"
  echo "  Copied  .github/workflows/ ($(find "$GITHUB_DIR/workflows" -name '*.yml' | wc -l | tr -d ' ') files)"
elif [ -d "$GITHUB_DIR/workflows" ]; then
  echo "  Skipped .github/workflows/ (already exists)"
fi

# --- schemas/ (referenced by hooks \$schema) ---
if [ -d "$REPO_ROOT/schemas" ]; then
  mkdir -p "$TARGET/schemas"
  cp "$REPO_ROOT/schemas/"*.json "$TARGET/schemas/" 2>/dev/null || true
  echo "  Copied  schemas/"
fi

# --- scripts/ci/ (validation scripts) ---
if [ -d "$REPO_ROOT/scripts/ci" ]; then
  mkdir -p "$TARGET/scripts/ci"
  cp "$REPO_ROOT/scripts/ci/"*.js "$TARGET/scripts/ci/" 2>/dev/null || true
  echo "  Copied  scripts/ci/"
fi

# --- .vscode/settings.json ---
VSCODE_DIR="$TARGET/.vscode"
mkdir -p "$VSCODE_DIR"

if [ -f "$VSCODE_DIR/settings.json" ]; then
  echo ""
  echo "  Warning: .vscode/settings.json already exists — not overwritten."
  echo "  Merge manually from: $REPO_ROOT/.vscode/settings.json"
else
  cp "$REPO_ROOT/.vscode/settings.json" "$VSCODE_DIR/settings.json"
  echo "  Copied  .vscode/settings.json"
fi

# --- AGENTS.md ---
if [ -f "$REPO_ROOT/AGENTS.md" ]; then
  cp "$REPO_ROOT/AGENTS.md" "$TARGET/AGENTS.md"
  echo "  Copied  AGENTS.md"
fi

# --- Install database dependencies ---
echo ""
echo "Installing database dependencies (better-sqlite3, sqlite-vec)..."
if [ ! -f "$TARGET/package.json" ]; then
  echo '{"private":true}' > "$TARGET/package.json"
  echo "  Created minimal package.json"
fi
if (cd "$TARGET" && npm install --no-audit --no-fund better-sqlite3 sqlite-vec 2>/dev/null); then
  echo "  Installed  better-sqlite3, sqlite-vec"
else
  echo "  Warning: Failed to install database dependencies."
  echo "  Run manually: cd $TARGET && npm install better-sqlite3 sqlite-vec"
fi

echo ""
echo "Done. Open the target project in VS Code to activate Copilot customizations."