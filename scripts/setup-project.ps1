#!/usr/bin/env pwsh
# setup-project.ps1 — Install Copilot customizations into a target project.
#
# Usage:
#   .\scripts\setup-project.ps1 C:\path\to\your-project
#   .\scripts\setup-project.ps1                          # uses current directory
#
# Copies .github/ Copilot assets and .vscode/settings.json into the target
# project so VS Code discovers instructions, prompts, agents, hooks, and skills.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Target = if ($args.Count -ge 1) { Resolve-Path $args[0] } else { Get-Location }
$Target = [string]$Target

if ((Resolve-Path $Target).Path -eq (Resolve-Path $RepoRoot).Path) {
    Write-Error "Error: target is the same as the source repository."
    exit 1
}

Write-Host "Source:  $RepoRoot"
Write-Host "Target:  $Target"
Write-Host ""

# --- .github/ Copilot assets ---
$GithubDir = Join-Path $Target '.github'
New-Item -ItemType Directory -Path $GithubDir -Force | Out-Null

# copilot-instructions.md
Copy-Item (Join-Path $RepoRoot '.github\copilot-instructions.md') (Join-Path $GithubDir 'copilot-instructions.md') -Force
Write-Host "  Copied  .github/copilot-instructions.md"

# instructions/
$SrcInst = Join-Path $RepoRoot '.github\instructions'
if (Test-Path $SrcInst) {
    $DstInst = Join-Path $GithubDir 'instructions'
    New-Item -ItemType Directory -Path $DstInst -Force | Out-Null
    $files = Get-ChildItem $SrcInst -Filter '*.instructions.md' -File
    $files | Copy-Item -Destination $DstInst -Force
    Write-Host "  Copied  .github/instructions/ ($($files.Count) files)"
}

# prompts/
$SrcProm = Join-Path $RepoRoot '.github\prompts'
if (Test-Path $SrcProm) {
    $DstProm = Join-Path $GithubDir 'prompts'
    New-Item -ItemType Directory -Path $DstProm -Force | Out-Null
    $files = Get-ChildItem $SrcProm -Filter '*.prompt.md' -File
    $files | Copy-Item -Destination $DstProm -Force
    Write-Host "  Copied  .github/prompts/ ($($files.Count) files)"
}

# agents/
$SrcAgent = Join-Path $RepoRoot '.github\agents'
if (Test-Path $SrcAgent) {
    $DstAgent = Join-Path $GithubDir 'agents'
    New-Item -ItemType Directory -Path $DstAgent -Force | Out-Null
    $files = Get-ChildItem $SrcAgent -Filter '*.agent.md' -File
    $files | Copy-Item -Destination $DstAgent -Force
    Write-Host "  Copied  .github/agents/ ($($files.Count) files)"
}

# hooks/
$SrcHook = Join-Path $RepoRoot '.github\hooks'
if (Test-Path $SrcHook) {
    $DstHook = Join-Path $GithubDir 'hooks'
    New-Item -ItemType Directory -Path $DstHook -Force | Out-Null
    Get-ChildItem $SrcHook -Filter '*.json' -File | Copy-Item -Destination $DstHook -Force
    Write-Host "  Copied  .github/hooks/"
}

# skills/
$SrcSkill = Join-Path $RepoRoot '.github\skills'
if (Test-Path $SrcSkill) {
    $DstSkill = Join-Path $GithubDir 'skills'
    Copy-Item $SrcSkill $DstSkill -Recurse -Force
    $count = (Get-ChildItem $DstSkill -Directory).Count
    Write-Host "  Copied  .github/skills/ ($count skills)"
}

# --- .vscode/settings.json ---
$VscodeDir = Join-Path $Target '.vscode'
New-Item -ItemType Directory -Path $VscodeDir -Force | Out-Null

$VsSettings = Join-Path $VscodeDir 'settings.json'
if (Test-Path $VsSettings) {
    Write-Host ""
    Write-Host "  Warning: .vscode/settings.json already exists - not overwritten."
    Write-Host "  Merge manually from: $RepoRoot\.vscode\settings.json"
} else {
    Copy-Item (Join-Path $RepoRoot '.vscode\settings.json') $VsSettings -Force
    Write-Host "  Copied  .vscode/settings.json"
}

# --- AGENTS.md ---
$AgentsMd = Join-Path $RepoRoot 'AGENTS.md'
if (Test-Path $AgentsMd) {
    Copy-Item $AgentsMd (Join-Path $Target 'AGENTS.md') -Force
    Write-Host "  Copied  AGENTS.md"
}

Write-Host ""
Write-Host "Done. Open the target project in VS Code to activate Copilot customizations."