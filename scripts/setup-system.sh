#!/usr/bin/env bash
# setup-system.sh — Install Copilot customizations system-wide.
#
# Usage:
#   ./scripts/setup-system.sh
#
# Copies instructions, agents, skills, and prompts to ~/.copilot/ so they
# apply to every VS Code workspace, and updates VS Code user settings to
# enable discovery paths.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Determine VS Code user settings path ---
if [ "$(uname)" = "Darwin" ]; then
  VSCODE_SETTINGS="$HOME/Library/Application Support/Code/User/settings.json"
elif [ -n "${APPDATA:-}" ]; then
  # Git Bash / MSYS2 on Windows
  VSCODE_SETTINGS="$APPDATA/Code/User/settings.json"
else
  VSCODE_SETTINGS="$HOME/.config/Code/User/settings.json"
fi

COPILOT_BASE="$HOME/.copilot"

echo "Source:  $REPO_ROOT"
echo "Target:  $COPILOT_BASE"
echo "VS Code: $VSCODE_SETTINGS"
echo ""

# --- Copy instructions ---
COPILOT_INST="$COPILOT_BASE/instructions"
mkdir -p "$COPILOT_INST"

SRC_INST="$REPO_ROOT/.github/instructions"
if [ -d "$SRC_INST" ]; then
  find "$SRC_INST" -maxdepth 1 -name '*.instructions.md' -exec cp {} "$COPILOT_INST/" \;
  count=$(find "$COPILOT_INST" -name '*.instructions.md' | wc -l | tr -d ' ')
  echo "  Copied $count instruction files to ~/.copilot/instructions/"
fi

COPILOT_INST_FILE="$REPO_ROOT/.github/copilot-instructions.md"
if [ -f "$COPILOT_INST_FILE" ]; then
  cp "$COPILOT_INST_FILE" "$COPILOT_INST/common-copilot.instructions.md"
  echo "  Copied copilot-instructions.md as common-copilot.instructions.md"
fi

# --- Copy agents ---
COPILOT_AGENTS="$COPILOT_BASE/agents"
mkdir -p "$COPILOT_AGENTS"

SRC_AGENTS="$REPO_ROOT/.github/agents"
if [ -d "$SRC_AGENTS" ]; then
  count=0
  for f in "$SRC_AGENTS"/*.agent.md "$SRC_AGENTS"/*.md; do
    [ -f "$f" ] || continue
    cp "$f" "$COPILOT_AGENTS/"
    count=$((count + 1))
  done
  echo "  Copied $count agent files to ~/.copilot/agents/"
fi

# --- Copy skills (recursive) ---
COPILOT_SKILLS="$COPILOT_BASE/skills"
mkdir -p "$COPILOT_SKILLS"

SRC_SKILLS="$REPO_ROOT/.github/skills"
if [ -d "$SRC_SKILLS" ]; then
  count=0
  for skill_dir in "$SRC_SKILLS"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    cp -r "$skill_dir" "$COPILOT_SKILLS/"
    count=$((count + 1))
  done
  echo "  Copied $count skills to ~/.copilot/skills/"
fi

# --- Copy prompts ---
COPILOT_PROMPTS="$COPILOT_BASE/prompts"
mkdir -p "$COPILOT_PROMPTS"

SRC_PROMPTS="$REPO_ROOT/.github/prompts"
if [ -d "$SRC_PROMPTS" ]; then
  count=0
  for f in "$SRC_PROMPTS"/*.prompt.md; do
    [ -f "$f" ] || continue
    cp "$f" "$COPILOT_PROMPTS/"
    count=$((count + 1))
  done
  echo "  Copied $count prompt files to ~/.copilot/prompts/"
fi

# --- Update VS Code user settings ---
VSCODE_DIR="$(dirname "$VSCODE_SETTINGS")"
mkdir -p "$VSCODE_DIR"

if [ ! -f "$VSCODE_SETTINGS" ]; then
  cat > "$VSCODE_SETTINGS" << 'SETTINGS'
{
  "chat.instructionsFilesLocations": {
    "~/.copilot/instructions": true
  },
  "chat.agentFilesLocations": {
    "~/.copilot/agents": true
  },
  "chat.agentSkillsLocations": {
    "~/.copilot/skills": true
  },
  "chat.promptFilesLocations": {
    "~/.copilot/prompts": true
  },
  "chat.includeApplyingInstructions": true,
  "chat.includeReferencedInstructions": true
}
SETTINGS
  echo "  Created VS Code user settings with ~/.copilot/ paths enabled"
elif ! grep -q '"~/.copilot/instructions"' "$VSCODE_SETTINGS" 2>/dev/null; then
  echo ""
  echo "  Note: Add the following to your VS Code user settings.json:"
  echo ""
  echo '    "chat.instructionsFilesLocations": { "~/.copilot/instructions": true },'
  echo '    "chat.agentFilesLocations":        { "~/.copilot/agents": true },'
  echo '    "chat.agentSkillsLocations":       { "~/.copilot/skills": true },'
  echo '    "chat.promptFilesLocations":       { "~/.copilot/prompts": true },'
  echo '    "chat.includeApplyingInstructions": true,'
  echo '    "chat.includeReferencedInstructions": true'
  echo ""
else
  echo "  VS Code user settings already include ~/.copilot/ paths"
fi

echo ""
echo "Done. Copilot customizations are now available system-wide."
echo ""
echo "To remove system-wide customizations:"
echo "  ./scripts/cleanup-system.sh"