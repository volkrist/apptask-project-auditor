# Перенос на другой компьютер (Windows)

После `git pull` код одинаковый, но **секреты и автозапуск** не в репозитории. Эта инструкция даёт тот же результат, что на рабочем ПК.

## Что уже в git (подтянется само)

| Файл / папка | Назначение |
|--------------|------------|
| Весь `src/`, `scripts/`, `tests/` | Код бота и аудита |
| `config/projects.json` | Доски → Discord (#аудитор) |
| `start-bot.bat`, `ensure-bot-running.bat` | Запуск и watchdog |
| `infra/windows/*.ps1` | Автозапуск и планировщик |
| `.env.example` | Шаблон переменных (без секретов) |

## Что НЕ в git — обязательно перенести вручную

### 1. Файл `.env` (главное)

Скопируйте **целиком** с рабочего компьютера (флешка, защищённый чат, менеджер паролей):

```
c:\Users\Volkr\Desktop\apptask-auditor\.env
```

Минимум для бота и аудита TurboWeave / Атаев Маркет:

| Переменная | Зачем |
|------------|--------|
| `DISCORD_BOT_TOKEN` | Discord-бот |
| `AUDIT_DISCORD_CHANNEL_ID` | Канал #аудитор |
| `APPTASK_DB_HOST`, `PORT`, `NAME`, `USER`, `PASSWORD` | Сбор карточек из БД |
| `APPTASK_DB_BOARD_IDS` | Напр. `783,789,445,54` |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` | Смета / Scrum |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Ключ сервисного аккаунта |
| `GOOGLE_WORK_SPREADSHEET_ID` | Таблица сметы |

Без `.env` бот не стартует, аудит не соберёт задачи.

> Playwright-профиль (`playwright/.user-data/`) **не нужен** для текущего режима: `APPTASK_COLLECTOR=db`.

## Быстрая настройка нового ПК

### Требования

- Windows 10/11
- [Node.js 20+](https://nodejs.org/)
- Git
- Доступ к SQL Server AppTask (VPN/whitelist, как на старом ПК)
- Тот же `.env`

### Шаги

```powershell
git clone https://github.com/volkrist/apptask-project-auditor.git
cd apptask-project-auditor
git pull   # если уже клонировали

# Скопируйте .env с рабочего ПК в папку проекта

# Одна команда: npm install + watchdog + автозапуск + проверка
.\setup-machine.bat
```

Или по шагам:

```powershell
npm install
npm run setup:check          # полная проверка (БД + Google)
start-bot.bat                # запуск бота
```

### Автозапуск (как здесь)

`setup-machine.bat` регистрирует:

| Компонент | Задача |
|-----------|--------|
| Бот при входе в Windows | Ярлык в Startup → `start-bot.bat` |
| Watchdog каждые 2 ч | `AppTask Bot Watchdog Repeat` |
| Watchdog через 1 мин после входа | `AppTask Bot Watchdog` |
| Аудит TurboWeave при входе (+3 мин) | `AppTask Audit At Startup` |

Отключить часть:

```powershell
powershell -ExecutionPolicy Bypass -File infra\windows\setup-machine.ps1 -SkipScheduledAudit
powershell -ExecutionPolicy Bypass -File infra\windows\setup-machine.ps1 -SkipWatchdog
```

## Проверка «всё как на старом ПК»

```powershell
npm run setup:check
```

Ожидаемо:

- `[OK]` `.env`, `DISCORD_BOT_TOKEN`, `APPTASK_DB_*`
- `[OK]` SQL Server
- `[OK]` Google Sheets (если заданы ключи)

В Discord: `/turboweave` — отчёт в #аудитор, задача №100 в нарушениях по п.16 и п.17 (после последнего обновления правил).

## Обновление с git на уже настроенном ПК

```powershell
git pull
npm install
npm run setup:check
# перезапуск бота если менялся код бота:
taskkill /F /PID (Get-Content logs\bot.pid)  # или закрыть процесс
start-bot.bat
```

`.env` и задачи Планировщика **не перезаписываются** при `git pull`.

## Частые проблемы

| Симптом | Причина | Решение |
|---------|---------|---------|
| Бот не отвечает в Discord | Нет `.env` или не запущен процесс | `npm run setup:check`, `start-bot.bat` |
| Аудит пустой / ошибка БД | Нет VPN или другой IP | Whitelist SQL, скопировать рабочий `.env` |
| Scrum/смета SKIP | Нет Google ключей | Скопировать `GOOGLE_SHEETS_*` в `.env` |
| Два бота / 10062 Discord | Два процесса | Один `start-bot.bat`, смотреть `logs/bot.pid` |

Подробнее про Windows: [WINDOWS_DEPLOY.md](./WINDOWS_DEPLOY.md).
