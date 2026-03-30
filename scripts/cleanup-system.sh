#!/usr/bin/env bash
# cleanup-system.sh -- Remove system-wide Copilot customizations.
#
# Usage:
#   ./scripts/cleanup-system.sh
#
# Removes ~/.copilot/{instructions,agents,skills,prompts} that were installed
# by setup-system.sh. Does NOT modify VS Code user settings -- disable the
# paths manually if needed.

set -euo pipefail

COPILOT_BASE="$HOME/.copilot"

echo "Cleaning up system-wide Copilot customizations..."
echo "Target: $COPILOT_BASE"
echo ""

removed=0

for subdir in instructions agents skills prompts; do
  target="$COPILOT_BASE/$subdir"
  if [ -d "$target" ]; then
    count=$(find "$target" -type f | wc -l | tr -d ' ')
    rm -rf "$target"
    echo "  Removed ~/.copilot/$subdir/ ($count files)"
    removed=$((removed + 1))
  else
    echo "  Skipped ~/.copilot/$subdir/ (not found)"
  fi
done

# Remove ~/.copilot if empty
if [ -d "$COPILOT_BASE" ] && [ -z "$(ls -A "$COPILOT_BASE" 2>/dev/null)" ]; then
  rmdir "$COPILOT_BASE"
  echo "  Removed empty ~/.copilot/"
fi

echo ""
if [ "$removed" -gt 0 ]; then
  echo "Done. System-wide customizations removed."
  echo ""
  echo "Optional: remove these entries from your VS Code user settings.json:"
  echo '  "chat.instructionsFilesLocations": { "~/.copilot/instructions": true }'
  echo '  "chat.agentFilesLocations":        { "~/.copilot/agents": true }'
  echo '  "chat.agentSkillsLocations":       { "~/.copilot/skills": true }'
  echo '  "chat.promptFilesLocations":       { "~/.copilot/prompts": true }'
else
  echo "Nothing to clean up."
fi
