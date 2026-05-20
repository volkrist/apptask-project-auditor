# Creates a Startup shortcut for start-bot.bat (idempotent).
$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$BatPath = Join-Path $ProjectRoot 'start-bot.bat'

if (-not (Test-Path -LiteralPath $BatPath)) {
    Write-Error "start-bot.bat not found: $BatPath"
}

$StartupFolder = [Environment]::GetFolderPath('Startup')
$ShortcutPath = Join-Path $StartupFolder 'AppTask Auditor Bot.lnk'

if (Test-Path -LiteralPath $ShortcutPath) {
    Write-Host "Startup shortcut already exists: $ShortcutPath"
    exit 0
}

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $BatPath
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.Description = 'AppTask Auditor Discord Bot'
$Shortcut.Save()

Write-Host "Created startup shortcut: $ShortcutPath"
Write-Host "Target: $BatPath"
