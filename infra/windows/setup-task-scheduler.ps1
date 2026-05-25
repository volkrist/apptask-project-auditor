# Registers or updates the daily scheduled audit (cards + comments) at 09:00 local time.
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BatPath = Join-Path $ProjectRoot 'start-scheduled-audit.bat'
$TaskName = 'AppTask Daily Audit'
$LegacyTaskName = 'AppTask Weekly Audit'

if (-not (Test-Path -LiteralPath $BatPath)) {
    Write-Error "start-scheduled-audit.bat not found: $BatPath"
}

$Action = New-ScheduledTaskAction -Execute $BatPath -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$legacy = Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue
if ($legacy) {
    Write-Host "Removing legacy task: $LegacyTaskName"
    Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Updating existing scheduled task: $TaskName"
} else {
    Write-Host "Creating scheduled task: $TaskName"
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description 'Daily AppTask audit: full cards (projects) + full comments at 09:00' `
    -Force | Out-Null

Write-Host "Task registered: $TaskName"
Write-Host "Schedule: every day at 09:00 (local PC time)"
Write-Host "Command: $BatPath"
Write-Host "Working directory: $ProjectRoot"
Write-Host "On failure: restart up to 3 times, interval 1 minute"
