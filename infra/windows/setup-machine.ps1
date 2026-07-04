# Full setup on a new Windows PC after git clone / pull.
# Usage (from project root):
#   powershell -ExecutionPolicy Bypass -File infra\windows\setup-machine.ps1
#   powershell -ExecutionPolicy Bypass -File infra\windows\setup-machine.ps1 -SkipWatchdog
param(
  [switch]$SkipWatchdog,
  [switch]$SkipScheduledAudit,
  [switch]$SkipNpmInstall
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $ProjectRoot

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "Required command not found: $name. Install Node.js 20+ from https://nodejs.org/"
  }
}

Write-Host "=== AppTask Auditor — machine setup ==="
Write-Host "Project: $ProjectRoot"
Write-Host ""

Require-Command node
Require-Command npm
Write-Host "Node: $(node -v)"

if (-not $SkipNpmInstall) {
  Write-Host ""
  Write-Host "[1/5] npm install..."
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'logs'))) {
  New-Item -ItemType Directory -Path (Join-Path $ProjectRoot 'logs') | Out-Null
}

$envPath = Join-Path $ProjectRoot '.env'
$examplePath = Join-Path $ProjectRoot '.env.example'
if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Host ""
  Write-Host "[!] .env not found."
  if (Test-Path -LiteralPath $examplePath) {
    Copy-Item -LiteralPath $examplePath -Destination $envPath
    Write-Host "    Created .env from .env.example — REPLACE with copy from your working PC!"
    Write-Host "    Secrets are NOT in git: DISCORD_BOT_TOKEN, APPTASK_DB_*, GOOGLE_SHEETS_*"
  } else {
    Write-Error ".env missing and no .env.example"
  }
} else {
  Write-Host ""
  Write-Host "[2/5] .env found."
}

Write-Host ""
Write-Host "[3/5] setup:check..."
npm run setup:check -- --quick
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "Fix .env (copy from working machine), then run: npm run setup:check"
  exit $LASTEXITCODE
}

if (-not $SkipWatchdog) {
  Write-Host ""
  Write-Host "[4/5] Bot autostart + watchdog (every 2h)..."
  & (Join-Path $PSScriptRoot 'setup-bot-resilience.ps1')
}

if (-not $SkipScheduledAudit) {
  Write-Host ""
  Write-Host "[5/5] TurboWeave audit at logon (+3 min)..."
  & (Join-Path $PSScriptRoot 'setup-scheduled-audit.ps1')
} else {
  Write-Host ""
  Write-Host "[5/5] Scheduled audit skipped (-SkipScheduledAudit)."
}

Write-Host ""
Write-Host "=== Done ==="
Write-Host "1. If .env was new — copy real .env from working PC (see docs/NEW_MACHINE_SETUP.md)"
Write-Host "2. Full check:  npm run setup:check"
Write-Host "3. Start bot:   start-bot.bat"
Write-Host "4. Discord test: /turboweave in #аудитор"
