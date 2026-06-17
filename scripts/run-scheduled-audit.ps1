# Legacy wrapper: runs TurboWeave audit (not full multi-board).
param(
  [switch]$Startup
)
$ErrorActionPreference = 'Stop'
if ($Startup) {
  Write-Host "[run-scheduled-audit] startup trigger - TurboWeave board 783 only"
}
& (Join-Path $PSScriptRoot 'run-turboweave-audit.ps1')
