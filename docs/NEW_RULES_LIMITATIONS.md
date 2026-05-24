# Ограничения новых проверок (4 пункта ТЗ)

Реализовано на полях `RawTask`: title, descriptionText, status, stage, assignees, assigneeRefs, comments (если парсер заполнит), creator. Users API (`get_users`) используется для blocked и QA по `roleUser`.

## Закрыто сейчас

| Пункт ТЗ | Правило | Как закрыто |
|----------|---------|-------------|
| 2 — незакрытые вопросы | `unresolved_question_keywords_in_card` | Маркеры в **title**, **descriptionText**, **comments[].text** (если есть) |
| 3 — тестировщик на проверке | `review_stage_requires_assignee` | На проверке: assignee обязателен; QA через `QA_TESTERS` и/или `roleUser` из users API |
| 4 — blocked assignee | `blocked_assignee_not_allowed` | `get_users.blocked` + assigneeRefs |

### Пункт 2 — закрыт по доступным полям карточки

Ключевые слова: `уточнить`, `обсудить`, `ждем ответ`, `ждём ответ`, `непонятно`.

Проверяются: `title`, `descriptionText`, `comments[].text` (пустой `comments[]` — не ошибка).

Сообщение при FAIL: «В {названии|описании|комментарии} карточки есть признак незакрытого вопроса: …».

Не анализируется, получил ли вопрос ответ — только наличие запрещённых маркеров.

### Пункт 3 — закрыт через assignees + QA

Этап проверки: `проверка`, `на проверке`, `testing`, `review`, `qa` в `status` или `stage`.

1. `assignees` / `assigneeRefs` пуст → FAIL («исполнитель/тестировщик не назначен»).
2. `QA_TESTERS` задан → среди исполнителей должен быть кто-то из списка (матч по userId, затем ФИО).
3. `QA_TESTERS` пуст, но users API с `roleUser` (QA / QA инженер / тестировщик / тестирование) → среди assignees должен быть пользователь с QA-ролью.
4. Иначе → PASS с reason «QA-список не задан, проверено только наличие исполнителя» (без ложного FAIL по QA).

## Не реализовано (следующий этап)

### Пункт 1 — ответы на вопросы в комментариях (не реализовано)

Проверка «все вопросы в комментариях получили ответ» **не реализована**: нет поля «вопрос закрыт» / ответ привязан к вопросу.

**Комментарии карточки на доске 445:** `get_task_comments` → `commentList: []` у всех проверенных задач; парсер комментариев доски не добавлен. Правило №2 проверяет `comments[]` **если** поле появится в `RawTask` позже.

**Диагностика (2026-05-22, `npx tsx scripts/probe-task-comments.ts`):**

| Источник | Результат |
|----------|-----------|
| DOM карточки | Есть UI вкладки комментариев (`modal-card-tab__wrapper--comments`, `add-comment`), **нет отрендеренных комментариев** на открытой карточке |
| API при открытии карточки | `POST …/board/get_task_comments` → `{ result, data: { id, commentList: [] } }` |
| `get_task_details` | `historyList: []`, `unreadCommentCount: 0` |
| Доска 445 (106 задач) | У всех задач в `get_tasks` — `unreadCommentCount: 0` |

Артефакты: `output/debug/task-card-comments.html`, `task-card-network.json`, `task-card-comments-sample.json`.

**Что подтверждено:** есть отдельный JSON-эндпоинт с массивом `commentList` (потенциально структурированные комментарии).

**Что не подтверждено** (пустой `commentList`, нет элементов в DOM):

- `commentId`, `parentCommentId` / `replyTo`
- `createdAt`, `author`
- `resolved` / `isResolved` / `closed`
- признак «это вопрос» и связь ответа с конкретным вопросом

Без непустого элемента `commentList[]` или явных полей вопрос/ответ/закрыт нельзя предложить достоверный `RawTask.comments` и нельзя внедрять правило без эвристики по тексту.

**Следующий шаг (по желанию):** повторить probe на карточке с непустыми комментариями (другая доска/задача) — только диагностика, без изменения audit/parser.

**Отдельный канал — трекинг / скриншоты / активность** (`npm run probe:tracking:comments`):

- URL: `APPTASK_ACTIVITIES_URL` или `--url` (пример: `/c/7/activities/2026-05-20/684/0`)
- Не путать с `POST …/board/get_task_comments` (на доске 445 `commentList` пустой)
- Артефакты: `output/debug/tracking-comments/*` (`network.json`, `dom-comments.json`, `summary.json`)
- Правило не внедрено — только поиск API/DOM источника комментариев к proof of activity

### Пункт 4 — уволенные / неактивные сотрудники

**Диагностика (2026-05-22, `npm run probe:users:inactive`):**

| Источник | Результат |
|----------|-----------|
| Users API | `POST …/panel/profile/get_users` → **101** пользователь (`data[]`) |
| Поля | `id`, `realName`, `email`, `blocked`, `confirmed`, `roleUser`, `boardPersonalList` |
| Активность | **`blocked: false` = активен (77)**, **`blocked: true` = заблокирован (24)** — совпадает с UI «77 из 101» |
| DOM таблица | 40 строк после scroll (виртуализация); полный список — только из API |
| Доска 445 (Найм) | `get_tasks.userList` часто пуст → assignees для compare на этой доске нет |

Артефакты: `output/debug/users-network.json`, `users-api-response.json`, `users-api-summary.json`, `users-all-visible.json`, `users-compare-diagnostic.json`, `output/debug/sections/*`.

**Не использовать как inactive:** «Учет времени: Выключен», отсутствие в DOM-таблице, отсутствие только в «активных 77» без поля `blocked`.

**Внедрено (hard-rule `blocked_assignee_not_allowed`):**

- Загрузка пользователей: `loadAppTaskUsers()` → `POST …/panel/profile/get_users` (`src/users/app-task-users.ts`), один раз перед сбором доски.
- Сопоставление assignee: сначала `userId` (из `.project-user[id]` на карточке), иначе нормализованное ФИО; в тексте FAIL указан тип совпадения.
- `blocked === true` → **FAIL**; assignee не найден в API → не FAIL (soft WARN `assignee_not_in_users_list`).
- Пустой/ошибочный users API → правило PASS (пропуск), audit не ломается.
- Семантика `blocked: true` подтверждена заказчиком: неактивный/уволенный/заблокированный — нельзя назначать задачи.

**Диагностика payroll (2026-05-22, `npm run probe:payroll:fired`):**

| Источник | Результат |
|----------|-----------|
| URL | `https://apptask.ru/c/7/reports/payment` (меню Отчёты → Зарплатный) |
| API | `POST …/TimeTracker/get_tracking_payment_summary` — 141 строк, `user.id` + `email`, **без** `realName` и **без** группы «Уволены» в JSON |
| DOM | Подзаголовок **«Не работали»** (40 ФИО, 0 ч за период), **не** «Уволены» |
| Сравнение | `blocked=true` (24) **не совпадает** с «Не работали» по ФИО (0 пересечений); все 24 `blocked` есть в payment API по `userId`, но **не отображаются** в таблице |
| Вывод | Для правила использовать **`get_users.blocked`**, не payroll-отчёт |

Артефакты: `output/debug/payroll-fired-network.json`, `payroll-fired-users.json`, `payroll-fired-summary.json`.
