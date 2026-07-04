# Registers Task Scheduler watchdog: every 2 hours + at logon, ensure Discord bot is running.
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BatPath = Join-Path $ProjectRoot 'ensure-bot-running.bat'
$TaskLogon = 'AppTask Bot Watchdog'
$TaskRepeat = 'AppTask Bot Watchdog Repeat'
$IntervalHours = 2

if (-not (Test-Path -LiteralPath $BatPath)) {
    Write-Error "ensure-bot-running.bat not found: $BatPath"
}

foreach ($name in @($TaskLogon, $TaskRepeat)) {
    cmd /c "schtasks /Delete /TN `"$name`" /F >nul 2>&1"
}

$tr = "`"$BatPath`""

# Hourly repeat via schtasks (reliable repetition interval).
schtasks /Create `
    /TN $TaskRepeat `
    /TR $tr `
    /SC HOURLY `
    /MO $IntervalHours `
    /RL LIMITED `
    /IT `
    /F | Out-Null

# At logon via Register-ScheduledTask (same pattern as setup-scheduled-audit.ps1).
$Action = New-ScheduledTaskAction -Execute $BatPath -WorkingDirectory $ProjectRoot
$LogonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$LogonTrigger.Delay = 'PT1M'
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$null = Register-ScheduledTask `
    -TaskName $TaskLogon `
    -Action $Action `
    -Trigger $LogonTrigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description 'Ensure AppTask Discord bot after logon (+1 min)' `
    -Force

Write-Host "Tasks registered:"
Write-Host "  $TaskLogon - at logon (+1 min)"
Write-Host "  $TaskRepeat - every $IntervalHours hour(s)"
Write-Host "Command: $BatPath"
Write-Host "Log: $ProjectRoot\logs\watchdog.log"
Write-Host ""
Write-Host "Run once now:"
Write-Host "  schtasks /Run /TN `"$TaskRepeat`""
