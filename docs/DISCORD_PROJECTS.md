# Discord: команды бота

## Проверка карточек (аудит правил)

| Команда | Описание |
|---------|----------|
| `/audit_full` | Полная проверка карточек по правилам (без комментариев). Опция `board_url` — необязательна; иначе `APPTASK_BOARD_URL` из `.env`. |
| `/audit_limit` | Проверка **N** карточек. Обязательный параметр `limit` (1–500). Опция `board_url` — необязательна. |

Отчёт публикуется в канал, где вызвана команда (виден всем). Прогресс и итог — в ответе на команду.

Команды `/audit` и `/comments` **удалены** из регистрации. Если Discord ещё показывает их из кэша, бот ответит подсказкой с новыми именами команд (без запуска проверки).

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

`run-scheduled-audit.ts` вызывает `getEnabledProjects()`:

1. Есть `enabled: true` в `config/projects.json` → для каждого: аудит доски → отчёт в `discordChannelId`.
2. Нет enabled-проектов → один прогон из `.env` (`APPTASK_BOARD_URL`, `AUDIT_DISCORD_CHANNEL_ID`).

## Ручное редактирование

Файл: `config/projects.json`. Пример: `samples/projects.example.json`.

Отключить проект без удаления: `"enabled": false`.

## Примеры

```
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
