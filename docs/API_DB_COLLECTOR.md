# DB-first collector (read-only)

## Безопасность

- **Только SELECT** — клиент отклоняет любые другие SQL-операции.
- Пароли и connection string **только в `.env`** (файл в `.gitignore`).
- Google Sheets — scope **`spreadsheets.readonly`**, без записи в таблицы.

## Probe (этап 1)

Настройте `.env`:

```env
APPTASK_DB_HOST=...
APPTASK_DB_PORT=1433
APPTASK_DB_NAME=...
APPTASK_DB_USER=...
APPTASK_DB_PASSWORD=...
APPTASK_DB_TRUST_SERVER_CERTIFICATE=true
APPTASK_DB_BOARD_IDS=783
```

Запуск:

```bash
npm run probe:collector:db -- --board-ids 783
# или несколько досок:
npm run probe:collector:db -- --board-ids 783,445,54
```

Вывод: статистика по доскам, статусы, блоки, комментарии, history, первые 10 URL задач.

`board_id=783` (TURBO WEAVE) — **только тестовый пример**, не hardcode в коде.

## Collector (этап 2)

```env
APPTASK_COLLECTOR=db
APPTASK_DB_BOARD_IDS=783,445
APPTASK_DB_FALLBACK=true   # при ошибке БД → Playwright
```

Данные маппятся в `RawTask` (id = `BoardTasks.id`, URL через `board_id` + `id`).

JOIN всегда по паре `task_id` + `board_id`.

## Tracking probe (этап 5)

```bash
npm run probe:tracking:db
```

Discovery структуры таблиц `UserTrackings*` — только SELECT.

## Scrum / Google Sheets (этап 3–4)

Read-only чтение Scrum-портала для правил сметы. Сопоставление по **коду + названию** (нет AppTask URL в смете).

В отчёте: disclaimer о точности matching.

## Команды

| Команда | Назначение |
|---------|------------|
| `npm run probe:collector:db` | Probe SQL collector |
| `npm run probe:tracking:db` | Probe tracking tables |
| `npm run test:collectors` | Unit-тесты mappers |
| `npm run test:scrum` | Unit-тесты Scrum matching |
