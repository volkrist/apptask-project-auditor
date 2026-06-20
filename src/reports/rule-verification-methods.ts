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
    "ПВ из Scrum / сметы + структура задач AppTask (БД)",
  sprint_dates_match:
    "Scrum / майлстоуны + рабочая Google-таблица проекта",
  actual_hours_exceeds_estimate:
    "фактическое время из tracking + ПВ из Scrum / сметы",
  estimate_exceeded_without_comment:
    "tracking + ПВ из Scrum / сметы + комментарии AppTask",
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
    "поиск точных фраз «проверено», «тестирование завершено» в комментариях AppTask",
  tester_feedback_has_proof:
    "поиск ссылок, вложений и слов «скрин», «видео» в комментариях AppTask",
  developer_active_tasks_limit:
    "подсчёт активных задач на исполнителя по статусам AppTask (БД)",
  unresolved_question_keywords_in_card:
    "поиск маркеров «уточнить», «обсудить», «ждём ответ», «непонятно» в тексте карточки AppTask",
  open_questions_closed:
    "текстовая проверка по фиксированным маркерам комментариев AppTask",
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
  assignee_present: "поле assignee карточки AppTask (БД)",
  blocked_assignee_not_allowed:
    "список заблокированных пользователей AppTask + assignee карточки",
  description_present: "поле description карточки AppTask (БД)",
  ui_has_mockup_link:
    "ссылки в description / links карточки AppTask",
  ui_mockup_approved:
    "поиск маркеров согласования макета в description карточки AppTask",
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
