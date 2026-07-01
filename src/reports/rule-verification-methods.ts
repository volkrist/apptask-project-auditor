/** Методы проверки для пользовательского отчёта (без технических терминов). */
export const RULE_VERIFICATION_METHODS: Record<string, string> = {
  deadline_less_than_one_day:
    "дедлайн и статус карточки в AppTask (БД)",
  high_priority_stale:
    "история статусов AppTask + поле priority (БД)",
  in_progress_stale:
    "история статусов AppTask + дата последнего изменения",
  review_stale:
    "история статусов AppTask + дата последнего изменения",
  review_queue_over_limit:
    "агрегация карточек AppTask в статусе проверки/QA (БД)",
  never_started_task:
    "история статусов AppTask + дата создания карточки",
  mass_start_without_completion:
    "активные задачи исполнителя в AppTask (БД) + история статусов",
  scrum_task_in_estimate:
    "сопоставление карточки AppTask со строкой Scrum / утверждённой сметы",
  scrum_title_matches_estimate:
    "название карточки AppTask + название строки в Scrum / смете",
  scrum_planned_hours_present:
    "наличие плановой оценки (ПВ) в Scrum / смете",
  scrum_decomposition_over_20h:
    "ПВ из Scrum / сметы (колонка «Под Задача») или ПВ из карточки AppTask (planned_end_time_offset)",
  sprint_dates_match:
    "Scrum / майлстоуны + рабочая Google-таблица проекта",
  actual_hours_exceeds_estimate:
    "фактическое время из tracking + ПВ из карточки AppTask (приоритет) или Scrum / сметы",
  estimate_exceeded_without_comment:
    "tracking + ПВ из карточки AppTask (приоритет) или Scrum / сметы + комментарии AppTask",
  done_task_without_tracking:
    "статус «Готово» в AppTask (БД) + сумма tracking",
  in_progress_without_recent_tracking:
    "статус «В работе» в AppTask (БД) + tracking за последний рабочий день",
  tracking_on_non_work_status:
    "сопоставление tracking со статусом карточки AppTask",
  tracking_daily_anomaly:
    "агрегация tracking по пользователю и дате",
  tracking_high_without_result:
    "tracking + наличие комментариев или описания результата по задаче",
  review_stage_requires_assignee:
    "поле assignee в AppTask (БД) + статус на этапе проверки",
  verified_success_comment:
    "поиск маркеров «проверено», QA-отчёта или закрытия задачи РМ в комментариях и описании AppTask",
  tester_feedback_has_proof:
    "поиск ссылок, вложений, img в HTML и слов «скрин», «видео» в комментариях с замечаниями QA",
  developer_active_tasks_limit:
    "подсчёт активных задач на исполнителя по статусам AppTask (БД)",
  unresolved_question_keywords_in_card:
    "поиск маркеров «уточнить», «обсудить», «ждём ответ», «непонятно» в тексте карточки AppTask",
  open_questions_closed:
    "маркеры вопроса в comments AppTask; ответ — тред (parent_id) или комментарий другого участника позже",
  rework_without_reason:
    "поиск маркеров причины возврата в комментариях и истории статусов AppTask",
  vague_done_comment:
    "поиск точных маркеров «готово», «сделал», «проверь» в комментариях AppTask",
  blocked_task_reason:
    "поиск маркеров причины блокировки в комментариях AppTask",
  blocked_tag_present: "поле tags карточки AppTask (БД)",
  board_name_template:
    "название доски AppTask (Boards.name) по шаблону проекта",
  board_folder_link:
    "AppTask Boards.description / comment (ссылка на папку проекта)",
  board_tz_summary:
    "AppTask Boards.description / comment (краткое описание из ТЗ)",
  project_worksheet_match:
    "метаданные доски AppTask + рабочая Google-таблица проекта",
  team_worksheet_match:
    "исполнители AppTask (БД) + рабочая таблица; Discord — отдельная подпроверка (см. подисточники)",
  team_role_rate_match:
    "рабочая Google-таблица проекта (роль и ставка участников)",
  task_type_classification:
    "классификация по category/stage и шаблонам названий AppTask (БД)",
  assignee_present:
    "поле assignee карточки AppTask (БД); только статусы «В процессе» и «На проверке»",
  title_present: "поле title карточки AppTask (БД) + пороги длины и конкретики",
  title_not_generic: "поле title карточки AppTask (БД) + список общих слов",
  description_has_goal:
    "поле content/description карточки AppTask (БД): фраза «цель задачи» или «ожидаемый результат», либо заголовок «Цель» в начале секции описания",
  assignee_not_in_users_list:
    "поле assignee карточки AppTask (БД) + users API AppTask",
  deadline_present: "поле dueDate карточки AppTask (БД)",
  deadline_not_overdue: "поля dueDate и status карточки AppTask (БД)",
  deadline_realistic: "поля dueDate и startDate карточки AppTask (БД)",
  deadline_start_not_after_due: "поля startDate и dueDate карточки AppTask (БД)",
  priority_present: "поле priority карточки AppTask (БД)",
  tags_required:
    "поле tags карточки AppTask (БД): минимум один тег + опционально REQUIRED_TAGS из .env",
  task_type_valid:
    "теги карточки AppTask (БД); допустимые значения — requiredTaskTypes в audit-config.ts",
  stage_matches_column:
    "поле stage (BoardSprints.name / «Этап» в UI) заполнено и ≠ status; для доски 783 — boardStageByStatus в audit-config.ts",
  estimate_present:
    "AppTask DB: planned_end_time_offset → plannedTime; описание/ссылки; Google Sheets смета (Scrum)",
  estimate_link_present:
    "описание и ссылки карточки AppTask (БД); паттерны estimateLinkPatterns; ПВ и Google-смета без ссылки в карточке не учитываются",
  artifact_links_present:
    "описание, ссылки и вложения карточки AppTask (БД); Google Sheets смета (строка задачи)",
  links_reachable:
    "описание и links карточки AppTask (БД); HTTP HEAD/GET; вложения из API/Playwright",
  not_duplicate: "сравнение названий карточек на одной доске AppTask (БД)",
  blocked_assignee_not_allowed:
    "AppTask DB: BoardTaskUsers + Users.blocked; API get_users при playwright/api collector",
  description_present: "поле description карточки AppTask (БД)",
  ui_has_mockup_link:
    "пара (UI/UX)+(front) с одним номером на доске или «верстка по макету»; Figma/mockup в description/links; функциональные front без пары UI/UX — NOT_APPLICABLE",
  ui_mockup_approved:
    "описание и комментарии карточки AppTask (БД); маркеры согласования макета",
  ui_adaptive_requirements:
    "поиск маркеров требований к адаптивности в description AppTask",
  ui_browser_device_requirements:
    "поиск маркеров требований к браузерам/устройствам в description AppTask",
  act_ready_naming:
    "название завершённой задачи AppTask по правилам для акта",
};

export function ruleVerificationMethod(ruleId: string): string {
  return (
    RULE_VERIFICATION_METHODS[ruleId] ??
    "правило профиля аудита (см. условие проверки)"
  );
}

/** Запрещённые слова в пользовательском отчёте. */
export const BANNED_USER_REPORT_TERMS = [
  "эвристик",
  "keyword/regex",
  "rule-based",
  "regex",
] as const;

export function assertUserFacingVerificationText(text: string): void {
  const lower = text.toLowerCase();
  for (const term of BANNED_USER_REPORT_TERMS) {
    if (lower.includes(term)) {
      throw new Error(`User report text contains banned term "${term}": ${text}`);
    }
  }
}
