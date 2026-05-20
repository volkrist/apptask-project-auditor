# Windows runtime deployment

Infrastructure for running the Discord bot at login and the weekly audit via Task Scheduler. Application code, env, and Playwright profile are unchanged — only these scripts and setup helpers.

## Prerequisites

- Node.js and `npm install` completed in the project root
- `.env` configured (see `.env.example`)
- Project path stable (scheduled task and startup shortcut use absolute paths from setup time)

## Autostart (Discord bot)

From the project root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File infra\windows\setup-startup.ps1
```

This creates a shortcut in the user **Startup** folder (`shell:startup`) pointing to `start-bot.bat`. After the next sign-in or reboot, Windows runs the bot and appends output to `logs\bot.log`.

Safe to run again: if the shortcut already exists, it is not duplicated.

### Disable autostart

1. Press `Win + R`, type `shell:startup`, Enter.
2. Delete **AppTask Auditor Bot.lnk**.

Or remove only the shortcut; do not delete `start-bot.bat` if you still run the bot manually.

## Weekly audit (Task Scheduler)

From the project root in PowerShell (may prompt for admin depending on policy):

```powershell
powershell -ExecutionPolicy Bypass -File infra\windows\setup-task-scheduler.ps1
```

Creates or updates task **AppTask Weekly Audit**:

| Setting | Value |
|--------|--------|
| Schedule | Every Monday, 08:00 |
| Action | `start-scheduled-audit.bat` |
| Working directory | Project root |
| On failure | Restart after 1 minute, up to 3 attempts |

Logs: `logs\scheduled.log`.

### Remove the scheduled task

PowerShell:

```powershell
Unregister-ScheduledTask -TaskName "AppTask Weekly Audit" -Confirm:$false
```

Or: **Task Scheduler** → find **AppTask Weekly Audit** → Delete.

## Verify

### Bot

1. Run once manually: double-click `start-bot.bat` or from cmd in project root:
   ```bat
   start-bot.bat
   ```
2. Check `logs\bot.log` for npm/Discord output.
3. After enabling startup, reboot or sign out/in and confirm the log grows.

### Weekly task

1. **Task Scheduler** → **AppTask Weekly Audit** → **Run** (right-click).
2. Check `logs\scheduled.log`.
3. Confirm `output\` contains a new audit folder after a successful run.

### List task (PowerShell)

```powershell
Get-ScheduledTask -TaskName "AppTask Weekly Audit" | Format-List *
Get-ScheduledTaskInfo -TaskName "AppTask Weekly Audit"
```

## Log files

| File | Source |
|------|--------|
| `logs\bot.log` | `start-bot.bat` → `npm run discord:bot` |
| `logs\scheduled.log` | `start-scheduled-audit.bat` → `npm run audit:scheduled` |

Audit artifacts remain under `output\` (unchanged).

## Manual runs (no setup)

From project root:

```bat
start-bot.bat
start-scheduled-audit.bat
```

Equivalent:

```bat
npm run discord:bot
npm run audit:scheduled
```

(Batch files redirect stdout/stderr to the log files above.)

## File map

```
apptask-auditor/
  start-bot.bat
  start-scheduled-audit.bat
  logs/
  infra/windows/
    setup-startup.ps1
    setup-task-scheduler.ps1
```

Setup scripts are **not** run automatically; run them once when you are ready.
