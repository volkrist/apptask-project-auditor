# Атаев Маркет audit: board 789 only → Discord #аудитор.
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $ProjectRoot

Write-Host "[run-ataev-market-audit] project=$ProjectRoot"
npm run audit:ataev-market
