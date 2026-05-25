# API-first collector (AppTask)

Быстрый режим сбора задач: Playwright используется только для авторизации и сессии, данные читаются через внутренние HTTP API AppTask (как в браузере на доске).

Старый DOM/Playwright collector **не удалён** — режим `playwright` по умолчанию, при критической ошибке API collector может откатиться на него.

## Переменные окружения

| Переменная | Значения | По умолчанию |
|------------|----------|--------------|
| `APPTASK_COLLECTOR` | `playwright` \| `api` | `playwright` |
| `API_DETAILS_MODE` | `off` \| `candidates` \| `all` | `candidates` |
| `COMMENTS_AUDIT_MODE` | `off` \| `candidates` \| `all` | `off` |
| `COMMENTS_AUDIT_LIMIT` | 1–300 | не задан (только загрузка комментариев; Discord `comments_limit` важнее) |
| `API_COLLECTOR_CONCURRENCY` | 1–10 | `3` |
| `APPTASK_API_BASE` | URL API host | `https://host2201.apptask.ru` (или host из network) |
| `APPTASK_SPRINT_ID` | число | авто из `get_sprints` |
| `APPTASK_API_FALLBACK` | `false` отключает fallback | fallback включён |

## Endpoints

- `POST /board/get_sprints` — sprintId
- `POST /board/get_states` — колонки/статусы
- `POST /board/get_blocks` — категории (blockId)
- `POST /board/get_tasks` — список задач по blockId + sprintId
- `POST /board/get_task_details` — описание, вложения
- `POST /board/get_task_comments` — комментарии
- `POST /panel/profile/get_users` — пользователи (creator, blocked, QA)

## Probe

```bat
npm run probe:collector:api -- --board-url "https://apptask.ru/c/7/board/54" --limit 20
```

Артефакты: `output/debug/api-collector/raw-tasks-sample.json`, `summary.json`.

## Audit в API режиме (cmd)

```bat
set APPTASK_COLLECTOR=api
npm run audit -- --board-url "https://apptask.ru/c/7/board/54" --limit 20
```

PowerShell:

```powershell
$env:APPTASK_COLLECTOR="api"
npm run audit -- --board-url "https://apptask.ru/c/7/board/54" --limit 20
```

Полный audit без `--limit` в API режиме не рекомендуется до проверки probe.
