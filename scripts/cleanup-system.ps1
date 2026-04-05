#!/usr/bin/env pwsh
# cleanup-system.ps1 — PowerShell wrapper for the user-level installer CLI.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$CliPath = Join-Path $RepoRoot 'scripts\installer\cli.js'
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue

if (-not $NodeCommand) {
    throw 'node is required but was not found in PATH.'
}

if (-not (Test-Path $CliPath)) {
    throw "Installer CLI not found: $CliPath"
}

Write-Host 'Running user-level uninstaller'
& $NodeCommand.Source $CliPath uninstall

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
