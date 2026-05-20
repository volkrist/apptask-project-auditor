# Multi-project mapping

One AppTask board maps to one Discord channel. Scheduled audits iterate all enabled projects in `config/projects.json`.

Parser, rules, reports, Playwright profile, and Discord bot runtime are unchanged.

## Add a project

1. Copy `samples/projects.example.json` to `config/projects.json` (or edit the existing file).
2. Append an entry:

```json
[
  {
    "id": "appfox",
    "name": "AppFox",
    "boardUrl": "https://apptask.ru/c/7/board/445",
    "discordChannelId": "1505507007040323676",
    "enabled": true
  },
  {
    "id": "client-b",
    "name": "Client B",
    "boardUrl": "https://apptask.ru/c/7/board/999",
    "discordChannelId": "9876543210987654321",
    "enabled": true
  }
]
```

| Field | Description |
|-------|-------------|
| `id` | Stable key (logs, filenames) |
| `name` | Display name in audit reports |
| `boardUrl` | AppTask board URL |
| `discordChannelId` | Channel ID for full report publish |
| `enabled` | `true` = included in scheduled runs; omit or `true` by default |

3. Ensure the bot can post to each channel (`DISCORD_BOT_TOKEN` unchanged).
4. Run scheduled setup as before (`npm run audit:scheduled` / Task Scheduler).

## Disable a project

Set `enabled` to `false`. The entry stays in the file but is skipped:

```json
{
  "id": "client-b",
  "name": "Client B",
  "boardUrl": "https://apptask.ru/c/7/board/999",
  "discordChannelId": "9876543210987654321",
  "enabled": false
}
```

## Fallback (.env single project)

If `config/projects.json` is missing, empty, or has no enabled entries, scheduled mode uses:

- `APPTASK_BOARD_URL`
- `AUDIT_DISCORD_CHANNEL_ID`
- `APPTASK_PROJECT_NAME` (optional, for report title)

Same behavior as before multi-project support.

## Flow (scheduled)

```
config/projects.json
  → getEnabledProjects()
  → for each enabled project:
       boardUrl → runAudit() → report files
       → resolveAuditChannel(discordChannelId)
       → publishFullReportToChannel()
```

Console logs per project:

```
[audit]
project=AppFox
board=https://...
channel=1505507007040323676
```

## Discord bot (slash `/audit`)

Unchanged: optional `board_url` or `APPTASK_BOARD_URL` in `.env`. Multi-project mapping applies to **scheduled** runs only.

## Files

| Path | Role |
|------|------|
| `config/projects.json` | Active mapping (edit this) |
| `samples/projects.example.json` | Template |
| `src/config/projects.ts` | Loader + env fallback |
