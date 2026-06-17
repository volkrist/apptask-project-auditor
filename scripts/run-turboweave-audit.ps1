# TurboWeave audit: board 783 only → Discord #прихожая (Атаев Маркет).
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

Write-Host "[run-turboweave-audit] project=$ProjectRoot"
npm run audit:turboweave
