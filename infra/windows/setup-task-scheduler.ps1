# Disables automatic full multi-board daily audit. Use setup-scheduled-audit.ps1 for TurboWeave at logon.
$ErrorActionPreference = 'Stop'

$LegacyTasks = @('AppTask Daily Audit', 'AppTask Weekly Audit')

foreach ($name in $LegacyTasks) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "Removing legacy automatic full-audit task: $name"
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
    } else {
        Write-Host "No legacy task: $name"
    }
}

Write-Host ""
Write-Host "Daily full multi-board audit is DISABLED."
Write-Host "For TurboWeave autostart (board 783, 3 min after logon):"
Write-Host "  powershell -ExecutionPolicy Bypass -File infra\windows\setup-scheduled-audit.ps1"
Write-Host ""
Write-Host "Manual full audit: npm run audit:full  or  /audit in Discord"
Write-Host "TurboWeave audit:  npm run audit:turboweave  or  /turboweave in Discord"
