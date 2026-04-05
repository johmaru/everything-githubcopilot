#!/usr/bin/env pwsh

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error 'Error: Node.js is required to run setup-project.'
    exit 1
}

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$CliPath = Join-Path $RepoRoot 'scripts\installer\project-setup.js'

& $node.Source $CliPath @args
exit $LASTEXITCODE