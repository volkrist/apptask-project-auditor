# Discord: настройка проектов и slash-команды

Связку **AppTask board → Discord channel** можно задать slash-командами бота, без web UI и без БД. Данные хранятся в `config/projects.json`.

Scheduled-аудит (`npm run audit:scheduled`) использует сохранённые проекты; если их нет — fallback из `.env`.

## Команды аудита карточек

| Команда | Описание |
|---------|----------|
| `/audit_full` | Полная проверка всех карточек на доске по правилам |
| `/audit_limit` | Проверка N карточек (`limit` — обязательный параметр) |

Опционально: `board_url` (иначе `APPTASK_BOARD_URL` из `.env`).

Ответ **ephemeral** (виден только вызвавшему). Публикация в канал из mapping выполняется только при scheduled-прогоне.

> **Устарело:** `/audit` — не используйте. Бот ответит подсказкой перейти на `/audit_full` или `/audit_limit`. После обновления бота перезапустите Discord (Ctrl+R), если старая команда ещё видна в списке.

## Команды проверки комментариев

| Команда | Описание |
|---------|----------|
| `/comments_full` | Полная проверка комментариев на доске |
| `/comments_limit` | Проверка комментариев у N задач (`limit` — обязательный) |

Опционально: `board_url` (иначе `APPTASK_COMMENTS_BOARD_URL` из `.env`).

> **Устарело:** `/comments` — используйте `/comments_full` или `/comments_limit`.

## `/project_add`

Сохраняет или обновляет проект (по `id`, сгенерированному из `name`).

| Параметр | Тип | Описание |
|----------|-----|----------|
| `name` | string | Имя проекта (например `AppFox`) |
| `board_url` | string | URL доски AppTask (`https://…`) |
| `channel` | channel | Discord-канал для отчётов |

Ответ (только вам, ephemeral):

```
Проект сохранён:
AppFox
https://apptask.ru/c/7/board/445
1505507007040323676
```

Если проект с таким `id` уже есть — запись **обновляется**.

## `/project_list`

Список всех записей в `config/projects.json`:

- name  
- boardUrl  
- channelId (`discordChannelId`)  
- enabled  

Если файл пустой:

```
Проекты пока не настроены.
```

## `/project_remove`

| Параметр | Описание |
|----------|----------|
| `name` | Имя проекта **или** `id` (например `appfox`) |

Удаляет запись из `config/projects.json`.

## Weekly / scheduled

`run-scheduled-audit.ts` вызывает `getEnabledProjects()`:

1. Есть `enabled: true` в `config/projects.json` → для каждого: аудит доски → отчёт в `discordChannelId`.
2. Нет enabled-проектов → один прогон из `.env`:
   - `APPTASK_BOARD_URL`
   - `AUDIT_DISCORD_CHANNEL_ID`
   - `APPTASK_PROJECT_NAME` (опционально)

Логи:

```
[audit]
project=AppFox
board=...
channel=...
```

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

После обновления кода перезапустите бота (`start-bot.bat` или `npm run discord:bot`), чтобы slash-команды зарегистрировались на сервере. В логе:

```
[discord] slash commands replaced: /audit_full, /audit_limit, /comments_full, /comments_limit
```

## Доступ для других пользователей

1. **Роль пользователя** на сервере: включить **Использовать слэш-команды** (Use Application Commands).
2. **Роль бота** в канале: View Channel, Send Messages, Attach Files, Embed Links, Use Application Commands.
3. **Один процесс бота** — только `start-bot.bat` или ярлык автозапуска. Второй запуск завершится: `logs/bot.pid` + `Already running`.
4. Долгий аудит без `limit` (>15 мин): Discord обнуляет interaction — бот пришлёт итог и **файлы в ЛС**, если канальный ответ истёк (нужны открытые DM).

В `logs/bot.log` при вызове:

```
[discord] interaction received command=/audit_limit user=...
[discord] deferReply ok command=/audit_limit
```

При устаревшей `/audit` из кэша Discord:

```
[discord] stale legacy command=/audit — use /audit_full, /audit_limit, ...
```
