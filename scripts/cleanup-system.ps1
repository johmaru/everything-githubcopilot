#!/usr/bin/env pwsh
# cleanup-system.ps1 -- Remove system-wide Copilot customizations.
#
# Usage:
#   .\scripts\cleanup-system.ps1
#
# Removes ~/.copilot/{instructions,agents,skills,prompts} that were installed
# by setup-system.ps1. Does NOT modify VS Code user settings -- disable the
# paths manually if needed.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$CopilotBase = Join-Path $HOME '.copilot'

Write-Host "Cleaning up system-wide Copilot customizations..."
Write-Host "Target: $CopilotBase"
Write-Host ""

$removed = 0

foreach ($subdir in @('instructions', 'agents', 'skills', 'prompts')) {
    $target = Join-Path $CopilotBase $subdir
    if (Test-Path $target) {
        $count = (Get-ChildItem $target -Recurse -File).Count
        Remove-Item $target -Recurse -Force
        Write-Host "  Removed ~/.copilot/$subdir/ ($count files)"
        $removed++
    } else {
        Write-Host "  Skipped ~/.copilot/$subdir/ (not found)"
    }
}

# Remove ~/.copilot if empty
if ((Test-Path $CopilotBase) -and ((Get-ChildItem $CopilotBase).Count -eq 0)) {
    Remove-Item $CopilotBase -Force
    Write-Host "  Removed empty ~/.copilot/"
}

Write-Host ""
if ($removed -gt 0) {
    Write-Host "Done. System-wide customizations removed."
    Write-Host ""
    Write-Host "Optional: remove these entries from your VS Code user settings.json:"
    Write-Host '  "chat.instructionsFilesLocations": { "~/.copilot/instructions": true }'
    Write-Host '  "chat.agentFilesLocations":        { "~/.copilot/agents": true }'
    Write-Host '  "chat.agentSkillsLocations":       { "~/.copilot/skills": true }'
    Write-Host '  "chat.promptFilesLocations":       { "~/.copilot/prompts": true }'
} else {
    Write-Host "Nothing to clean up."
}
