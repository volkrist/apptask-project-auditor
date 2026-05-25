# Windows runtime deployment

Infrastructure for running the Discord bot at login and the daily audit via Task Scheduler. Application code, env, and Playwright profile are unchanged — only these scripts and setup helpers.

## Prerequisites

- Node.js and `npm install` completed in the project root
- `.env` configured (see `.env.example`)
- Project path stable (scheduled task and startup shortcut use absolute paths from setup time)

## API collector (optional)

Fast task collection via internal AppTask HTTP APIs (Playwright only for session). See [API_COLLECTOR.md](./API_COLLECTOR.md). Default remains `APPTASK_COLLECTOR=playwright`.

## Autostart (Discord bot)

From the project root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File infra\windows\setup-startup.ps1
```

This creates a shortcut in the user **Startup** folder (`shell:startup`) pointing to `start-bot.bat`. After the next sign-in or reboot, Windows runs the bot and appends output to `logs\bot.log`.

Safe to run again: if the shortcut already exists, it is not duplicated.

### `logs\bot.pid` (single instance)

`start-bot.bat` and the Node bot both use `logs\bot.pid` to prevent two Discord bots at once:

1. If the file exists, `start-bot.bat` reads the PID and checks it with `tasklist`.
2. **Process still running** → prints `bot already running, pid=…` and exits (no second process).
3. **Process gone** (stale lock after crash or reboot) → deletes `logs\bot.pid` and starts the bot.
4. On a successful start, the bot process writes its own PID into `logs\bot.pid` (see `bot-lock.ts`).

You normally do not need to delete `bot.pid` by hand after a reboot.

### Disable autostart

1. Press `Win + R`, type `shell:startup`, Enter.
2. Delete **AppTask Auditor Bot.lnk**.

Or remove only the shortcut; do not delete `start-bot.bat` if you still run the bot manually.

## Daily audit (Task Scheduler)

From the project root in PowerShell (may prompt for admin depending on policy):

```powershell
powershell -ExecutionPolicy Bypass -File infra\windows\setup-task-scheduler.ps1
```

Creates or updates task **AppTask Daily Audit** (removes legacy **AppTask Weekly Audit** if present):

| Setting | Value |
|--------|--------|
| Schedule | Every day, **09:00** (local PC time) |
| Action | `start-scheduled-audit.bat` → `npm run audit:scheduled` |
| Cards | Full audit per enabled project in `config/projects.json` |
| Comments | Full check on `APPTASK_COMMENTS_BOARD_URL` |
| Publish | Discord channel per project + comments to `AUDIT_DISCORD_CHANNEL_ID` |
| On failure | Restart after 1 minute, up to 3 attempts |

Logs: `logs\scheduled.log`.

Requires `.env`: `DISCORD_BOT_TOKEN`, `APPTASK_COMMENTS_BOARD_URL`, projects or `APPTASK_BOARD_URL` + `AUDIT_DISCORD_CHANNEL_ID`.

### Remove the scheduled task

PowerShell:

```powershell
Unregister-ScheduledTask -TaskName "AppTask Daily Audit" -Confirm:$false
```

Or: **Task Scheduler** → find **AppTask Daily Audit** → Delete.

## Verify

### Bot

1. Run once manually: double-click `start-bot.bat` or from cmd in project root:
   ```bat
   start-bot.bat
   ```
2. Check `logs\bot.log` for npm/Discord output.
3. After enabling startup, reboot or sign out/in and confirm the log grows.

### Daily task

1. **Task Scheduler** → **AppTask Daily Audit** → **Run** (right-click).
2. Check `logs\scheduled.log`.
3. Confirm `output\` contains new `audit-*` and `comments-*` folders after a successful run.

### List task (PowerShell)

```powershell
Get-ScheduledTask -TaskName "AppTask Daily Audit" | Format-List *
Get-ScheduledTaskInfo -TaskName "AppTask Daily Audit"
```

## Log files

| File | Source |
|------|--------|
| `logs\bot.log` | `start-bot.bat` → `npm run discord:bot` (stdout/stderr append) |
| `logs\bot.pid` | Lock file: live bot PID; stale locks removed automatically by `start-bot.bat` |
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
