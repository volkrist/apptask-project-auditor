# Registers TurboWeave audit at Windows logon (+3 min delay). Bot startup is separate (setup-startup.ps1).
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BatPath = Join-Path $ProjectRoot 'start-turboweave-audit.bat'
$TaskName = 'AppTask Audit At Startup'
$LegacyDailyTask = 'AppTask Daily Audit'
$LegacyWeeklyTask = 'AppTask Weekly Audit'

if (-not (Test-Path -LiteralPath $BatPath)) {
    Write-Error "start-turboweave-audit.bat not found: $BatPath"
}

foreach ($legacy in @($LegacyDailyTask, $LegacyWeeklyTask)) {
    $existing = Get-ScheduledTask -TaskName $legacy -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Removing legacy full-audit task: $legacy"
        Unregister-ScheduledTask -TaskName $legacy -Confirm:$false
    }
}

$Action = New-ScheduledTaskAction -Execute $BatPath -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Trigger.Delay = 'PT3M'
$Settings = New-ScheduledTaskSettingsSet `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Updating scheduled task: $TaskName"
} else {
    Write-Host "Creating scheduled task: $TaskName"
}

$null = Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description 'TurboWeave audit (board 783) 3 min after logon' `
    -Force

Write-Host "Task registered: $TaskName"
Write-Host "Trigger: At logon, delay 3 minutes"
Write-Host "Command: $BatPath"
Write-Host "Mode: TurboWeave only (board 783), NOT full 783,445,54"
Write-Host "Working directory: $ProjectRoot"
