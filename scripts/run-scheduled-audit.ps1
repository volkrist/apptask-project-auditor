# Legacy wrapper: runs TurboWeave audit (not full multi-board).
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'run-turboweave-audit.ps1')
