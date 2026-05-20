# Discord: настройка проектов (board → channel)

Связку **AppTask board → Discord channel** можно задать slash-командами бота, без web UI и без БД. Данные хранятся в `config/projects.json`.

Команда `/audit` не меняется. Weekly / scheduled (`npm run audit:scheduled`) использует сохранённые проекты; если их нет — старый fallback из `.env`.

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

## `/audit`

Без изменений:

- можно передать `board_url`;
- если нет — используется `APPTASK_BOARD_URL` из `.env`;
- ответ по-прежнему ephemeral, публикация в канал из mapping **не** выполняется (только scheduled).

## Ручное редактирование

Файл: `config/projects.json`. Пример: `samples/projects.example.json`.

Отключить проект без удаления: `"enabled": false`.

## Примеры

```
/project_add name:AppFox board_url:https://apptask.ru/c/7/board/445 channel:#audit-reports

/project_list

/project_remove name:AppFox
```

После добавления команд перезапустите бота (`npm run discord:bot`), чтобы slash-команды зарегистрировались на сервере.
