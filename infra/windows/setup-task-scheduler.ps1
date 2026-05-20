# Registers or updates the weekly scheduled audit task (idempotent).
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BatPath = Join-Path $ProjectRoot 'start-scheduled-audit.bat'
$TaskName = 'AppTask Weekly Audit'

if (-not (Test-Path -LiteralPath $BatPath)) {
    Write-Error "start-scheduled-audit.bat not found: $BatPath"
}

$Action = New-ScheduledTaskAction -Execute $BatPath -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '08:00'
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

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
    -Description 'Weekly AppTask audit (Monday 08:00)' `
    -Force | Out-Null

Write-Host "Task registered: $TaskName"
Write-Host "Schedule: every Monday at 08:00"
Write-Host "Command: $BatPath"
Write-Host "Working directory: $ProjectRoot"
Write-Host "On failure: restart up to 3 times, interval 1 minute"
