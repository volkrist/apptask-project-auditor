# One-shot setup: Startup shortcut + Task Scheduler watchdog (every 2h + at logon).
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
& (Join-Path $Here 'setup-startup.ps1')
Write-Host ''
& (Join-Path $Here 'setup-bot-watchdog.ps1')
Write-Host ''
Write-Host 'Bot resilience enabled: autostart at login + watchdog every 2 hours.'
