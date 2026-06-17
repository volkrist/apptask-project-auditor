# Discord: команды бота

## Проверка карточек (аудит правил)

| Команда | Описание |
|---------|----------|
| **`/turboweave`** | **TurboWeave** — board 783 + Scrum + tracking → `#прихожая` (автозапуск Windows) |
| **`/audit`** | **Полный аудит** всех досок **783,445,54** — только вручную |
| `/audit_full` | То же, что `/audit` без limit (алиас). |
| `/audit_limit` | Проверка **N** карточек. Обязательный `limit` (1–500). |

Отчёт публикуется в **`AUDIT_DISCORD_CHANNEL_ID`** из `.env`. Команда **`/turboweave`** временно подставляет канал `#прихожая` (Атаев Маркет). **`/audit`** — полный multi-board 783,445,54. Прогресс slash-команды — ephemeral.

Команда `/comments` **удалена** из регистрации (бот подскажет `/comments_full` / `/comments_limit`).

## Проверка комментариев

| Команда | Описание |
|---------|----------|
| `/comments_full` | Полная проверка комментариев на доске (без аудита карточек). Опция `board_url` — необязательна; иначе `APPTASK_COMMENTS_BOARD_URL`. |
| `/comments_limit` | Проверка комментариев у **N** задач. Обязательный `limit`. Опция `board_url` — необязательна. |

Не используется `APPTASK_BOARD_URL` — только `APPTASK_COMMENTS_BOARD_URL` или явный `board_url`.

## Настройка проектов (board → channel)

Связку **AppTask board → Discord channel** можно задать slash-командами, без web UI. Данные в `config/projects.json`.

### `/project_add`

| Параметр | Тип | Описание |
|----------|-----|----------|
| `name` | string | Имя проекта (например `AppFox`) |
| `board_url` | string | URL доски AppTask (`https://…`) |
| `channel` | channel | Discord-канал для отчётов |

Ответ только вам (ephemeral).

### `/project_list`

Список записей в `config/projects.json` (name, boardUrl, channelId, enabled).

### `/project_remove`

| Параметр | Описание |
|----------|----------|
| `name` | Имя проекта **или** `id` (например `appfox`) |

## Scheduled / daily audit

`run-scheduled-audit` / автозапуск Windows → **TurboWeave only** (`npm run audit:turboweave`, board 783).

1. Задача **AppTask Audit At Startup** (см. `infra/windows/setup-scheduled-audit.ps1`) — TurboWeave через 3 мин после входа.
2. **AppTask Daily Audit** (full 783,445,54) **отключён** — `setup-task-scheduler.ps1` удаляет legacy-задачу.
3. Ручной full: `/audit` или `npm run audit:full`.

## Ручное редактирование

Файл: `config/projects.json`. Пример: `samples/projects.example.json`.

Отключить проект без удаления: `"enabled": false`.

## Примеры

```
/audit

/audit limit:5

/audit_limit limit:5

/comments_limit limit:10

/project_add name:AppFox board_url:https://apptask.ru/c/7/board/445 channel:#audit-reports

/project_list

/project_remove name:AppFox
```

После обновления бота перезапустите процесс (`start-bot.bat`) и обновите список команд в Discord (**Ctrl+R** в клиенте).

## Доступ для других пользователей

1. Роль пользователя: **Использовать слэш-команды** (Use Application Commands).
2. Роль бота в канале: View Channel, Send Messages, Attach Files, Embed Links, Use Application Commands.
3. **Один процесс бота** — `start-bot.bat` или ярлык автозапуска. Второй запуск завершится: `logs/bot.pid`.
4. Долгий аудит без `limit` (>15 мин): Discord может истечь interaction — бот пришлёт итог в ЛС.

В `logs/bot.log` при вызовах:

```
[discord] interaction received command=/audit_limit user=...
[discord] deferReply ok command=/audit_limit
```
