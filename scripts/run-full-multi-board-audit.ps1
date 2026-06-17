# Full multi-board audit: 783,445,54 — manual only, NOT for Task Scheduler.
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

Write-Host "[run-full-multi-board-audit] project=$ProjectRoot"
npm run audit:full
