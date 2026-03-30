#!/usr/bin/env pwsh
# setup-system.ps1 — Install Copilot customizations system-wide.
#
# Usage:
#   .\scripts\setup-system.ps1
#
# Copies instructions, agents, skills, prompts, hooks, and hook scripts to
# ~/.copilot/ so they apply to every VS Code workspace, and updates VS Code
# user settings to enable discovery paths.
#
# Hook commands are rewritten to use absolute paths so they work regardless
# of the current working directory.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# --- Determine paths ---
$CopilotBase = Join-Path $HOME '.copilot'

# Use $env:OS first — $IsWindows is undefined in Windows PowerShell 5.1 and
# Set-StrictMode -Version Latest would throw a terminating error.
if ($env:OS -eq 'Windows_NT') {
    $VsSettings = Join-Path (Join-Path (Join-Path $env:APPDATA 'Code') 'User') 'settings.json'
} elseif ($IsMacOS) {
    $VsSettings = Join-Path (Join-Path (Join-Path (Join-Path (Join-Path $HOME 'Library') 'Application Support') 'Code') 'User') 'settings.json'
} else {
    $VsSettings = Join-Path (Join-Path (Join-Path (Join-Path $HOME '.config') 'Code') 'User') 'settings.json'
}

Write-Host "Source:  $RepoRoot"
Write-Host "Target:  $CopilotBase"
Write-Host "VS Code: $VsSettings"
Write-Host ""

# --- Copy instructions ---
$CopilotInst = Join-Path $CopilotBase 'instructions'
New-Item -ItemType Directory -Path $CopilotInst -Force | Out-Null

$SrcInst = Join-Path (Join-Path $RepoRoot '.github') 'instructions'
if (Test-Path $SrcInst) {
    $files = Get-ChildItem $SrcInst -Filter '*.instructions.md' -File
    $files | Copy-Item -Destination $CopilotInst -Force
    Write-Host "  Copied $($files.Count) instruction files to ~/.copilot/instructions/"
}

$CopilotInstFile = Join-Path (Join-Path $RepoRoot '.github') 'copilot-instructions.md'
if (Test-Path $CopilotInstFile) {
    Copy-Item $CopilotInstFile (Join-Path $CopilotInst 'common-copilot.instructions.md') -Force
    Write-Host "  Copied copilot-instructions.md as common-copilot.instructions.md"
}

# --- Copy agents ---
$CopilotAgents = Join-Path $CopilotBase 'agents'
New-Item -ItemType Directory -Path $CopilotAgents -Force | Out-Null

$SrcAgents = Join-Path (Join-Path $RepoRoot '.github') 'agents'
if (Test-Path $SrcAgents) {
    $agentFiles = Get-ChildItem $SrcAgents -Filter '*.md' -File
    $agentFiles | Copy-Item -Destination $CopilotAgents -Force
    Write-Host "  Copied $($agentFiles.Count) agent files to ~/.copilot/agents/"
}

# --- Copy skills (recursive) ---
$CopilotSkills = Join-Path $CopilotBase 'skills'
New-Item -ItemType Directory -Path $CopilotSkills -Force | Out-Null

$SrcSkills = Join-Path (Join-Path $RepoRoot '.github') 'skills'
if (Test-Path $SrcSkills) {
    $skillDirs = Get-ChildItem $SrcSkills -Directory
    foreach ($dir in $skillDirs) {
        Copy-Item $dir.FullName -Destination $CopilotSkills -Recurse -Force
    }
    Write-Host "  Copied $($skillDirs.Count) skills to ~/.copilot/skills/"
}

# --- Copy prompts ---
$CopilotPrompts = Join-Path $CopilotBase 'prompts'
New-Item -ItemType Directory -Path $CopilotPrompts -Force | Out-Null

$SrcPrompts = Join-Path (Join-Path $RepoRoot '.github') 'prompts'
if (Test-Path $SrcPrompts) {
    $promptFiles = Get-ChildItem $SrcPrompts -Filter '*.prompt.md' -File
    $promptFiles | Copy-Item -Destination $CopilotPrompts -Force
    Write-Host "  Copied $($promptFiles.Count) prompt files to ~/.copilot/prompts/"
}

# --- Copy hooks ---
$CopilotHooks = Join-Path $CopilotBase 'hooks'
New-Item -ItemType Directory -Path $CopilotHooks -Force | Out-Null

$SrcHooks = Join-Path (Join-Path $RepoRoot '.github') 'hooks'
if (Test-Path $SrcHooks) {
    $hookFiles = Get-ChildItem $SrcHooks -Filter '*.json' -File
    $hookFiles | Copy-Item -Destination $CopilotHooks -Force
    Write-Host "  Copied $($hookFiles.Count) hook definitions to ~/.copilot/hooks/"
}

# --- Copy hook scripts ---
$CopilotHookScripts = Join-Path (Join-Path $CopilotBase 'scripts') 'hooks'
New-Item -ItemType Directory -Path $CopilotHookScripts -Force | Out-Null

$SrcHookScripts = Join-Path (Join-Path $RepoRoot 'scripts') 'hooks'
if (Test-Path $SrcHookScripts) {
    $scriptFiles = Get-ChildItem $SrcHookScripts -Filter '*.js' -File
    $scriptFiles | Copy-Item -Destination $CopilotHookScripts -Force
    Write-Host "  Copied $($scriptFiles.Count) hook scripts to ~/.copilot/scripts/hooks/"
}

# --- Copy schemas ---
$CopilotSchemas = Join-Path $CopilotBase 'schemas'
New-Item -ItemType Directory -Path $CopilotSchemas -Force | Out-Null

$SrcSchemas = Join-Path $RepoRoot 'schemas'
if (Test-Path $SrcSchemas) {
    $schemaFiles = Get-ChildItem $SrcSchemas -Filter '*.json' -File
    $schemaFiles | Copy-Item -Destination $CopilotSchemas -Force
    Write-Host "  Copied $($schemaFiles.Count) schema files to ~/.copilot/schemas/"
}

# --- Rewrite hook command paths to absolute ---
foreach ($jsonFile in (Get-ChildItem $CopilotHooks -Filter '*.json' -File -ErrorAction SilentlyContinue)) {
    $json = Get-Content $jsonFile.FullName -Raw
    $absScriptsHooks = (Join-Path (Join-Path $CopilotBase 'scripts') 'hooks') -replace '\\', '/'
    $json = $json -replace [regex]::Escape('./scripts/hooks/'), "$absScriptsHooks/"
    $json = $json -replace [regex]::Escape('../../schemas/hooks.schema.json'), '../schemas/hooks.schema.json'
    Set-Content $jsonFile.FullName $json -Encoding UTF8
    Write-Host "  Rewrote hook paths in $($jsonFile.Name) to use absolute script locations"
}

# --- Update VS Code user settings ---
$VsDir = Split-Path -Parent $VsSettings
New-Item -ItemType Directory -Path $VsDir -Force | Out-Null

if (-not (Test-Path $VsSettings)) {
    $newSettings = @{
        'chat.instructionsFilesLocations' = @{ '~/.copilot/instructions' = $true }
        'chat.agentFilesLocations'        = @{ '~/.copilot/agents' = $true }
        'chat.agentSkillsLocations'       = @{ '~/.copilot/skills' = $true }
        'chat.promptFilesLocations'       = @{ '~/.copilot/prompts' = $true }
        'chat.includeApplyingInstructions'    = $true
        'chat.includeReferencedInstructions'  = $true
    }
    $newSettings | ConvertTo-Json -Depth 5 | Set-Content $VsSettings -Encoding UTF8
    Write-Host "  Created VS Code user settings with ~/.copilot/ paths enabled"
} else {
    $content = Get-Content $VsSettings -Raw
    if ($content -match '~/.copilot/instructions') {
        Write-Host "  VS Code user settings already include ~/.copilot/ paths"
    } else {
        Write-Host ""
        Write-Host "  Note: Add the following to your VS Code user settings.json:"
        Write-Host ""
        Write-Host '    "chat.instructionsFilesLocations": { "~/.copilot/instructions": true },'
        Write-Host '    "chat.agentFilesLocations":        { "~/.copilot/agents": true },'
        Write-Host '    "chat.agentSkillsLocations":       { "~/.copilot/skills": true },'
        Write-Host '    "chat.promptFilesLocations":       { "~/.copilot/prompts": true },'
        Write-Host '    "chat.includeApplyingInstructions": true,'
        Write-Host '    "chat.includeReferencedInstructions": true'
        Write-Host ""
    }
}

Write-Host ""
Write-Host "Done. Copilot customizations are now available system-wide."
Write-Host ""
Write-Host "To remove system-wide customizations:"
Write-Host "  .\scripts\cleanup-system.ps1"