# Removes AppTask Bot Watchdog scheduled tasks.
$ErrorActionPreference = 'Stop'

foreach ($name in @('AppTask Bot Watchdog', 'AppTask Bot Watchdog Repeat')) {
    if ($name -eq 'AppTask Bot Watchdog') {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed: $name"
        } else {
            Write-Host "Not found: $name"
        }
        continue
    }
    $out = schtasks /Query /TN $name 2>&1
    if ($LASTEXITCODE -eq 0) {
        schtasks /Delete /TN $name /F | Out-Null
        Write-Host "Removed: $name"
    } else {
        Write-Host "Not found: $name"
    }
}
