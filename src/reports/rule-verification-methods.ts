/** Как выполняется проверка — для web/markdown отчёта (честная маркировка эвристик). */
export const RULE_VERIFICATION_METHODS: Record<string, string> = {
  deadline_less_than_one_day: "поле deadline / dueDate в БД AppTask",
  high_priority_stale: "история статусов + поле priority",
  in_progress_stale: "история статусов + timestamp последнего изменения",
  review_stale: "история статусов + timestamp последнего изменения",
  review_queue_over_limit: "агрегация карточек в статусе проверки/QA на доске",
  never_started_task: "история статусов + дата создания карточки",
  mass_start_without_completion:
    "консервативная эвристика по активным задачам исполнителя",
  scrum_task_in_estimate: "сравнение taskId с утверждённой сметой Scrum",
  scrum_title_matches_estimate: "сравнение названия AppTask со строкой сметы",
  scrum_planned_hours_present: "поле ПВ в Google Sheet / Scrum",
  scrum_decomposition_over_20h: "ПВ в Scrum + наличие подзадач на доске",
  sprint_dates_match: "сравнение дат спринтов Scrum с майлстоунами рабочей таблицы",
  actual_hours_exceeds_estimate: "расчёт по tracking vs ПВ из Scrum",
  estimate_exceeded_without_comment:
    "tracking vs ПV + keyword/regex эвристика по комментариям",
  done_task_without_tracking: "статус «Готово» + сумма tracking",
  in_progress_without_recent_tracking:
    "статус «В работе» + tracking за последний рабочий день",
  tracking_on_non_work_status: "сопоставление tracking со статусом карточки",
  tracking_daily_anomaly: "расчёт по tracking (сумма часов за день по пользователю)",
  tracking_high_without_result:
    "tracking + keyword/regex эвристика по комментариям/результату",
  review_stage_requires_assignee: "поле assignee + статус на этапе проверки",
  verified_success_comment:
    "поиск точных фраз и аналогов («проверено», «тестирование завершено») в комментариях",
  tester_feedback_has_proof:
    "поиск ссылок, attachments и слов «скрин», «видео» в комментариях",
  developer_active_tasks_limit:
    "подсчёт активных задач на исполнителя по статусам",
  unresolved_question_keywords_in_card:
    "keyword/regex эвристика по тексту карточки",
  open_questions_closed: "keyword/regex эвристика по комментариям",
  rework_without_reason: "keyword/regex эвристика по комментариям и статусам",
  vague_done_comment: "keyword/regex эвристика по комментариям",
  blocked_task_reason: "keyword/regex эвристика + комментарии (причина блокировки)",
  blocked_tag_present: "поле tags в БД AppTask",
  board_name_template: "rule-based классификатор по названию доски",
  board_folder_link: "текст description/comment доски (ссылка на папку)",
  board_tz_summary: "текст description/comment доски (описание ТЗ)",
  project_worksheet_match: "сравнение AppTask board metadata с рабочей таблицей",
  team_worksheet_match:
    "AppTask assignees + Discord guild members + рабочая таблица",
  team_role_rate_match: "рабочая таблица (роль и ставка участников)",
  task_type_classification:
    "rule-based классификатор по названию, category/stage и flow-шаблонам",
  assignee_present: "поле assignee в БД AppTask",
  blocked_assignee_not_allowed: "список заблокированных пользователей AppTask",
  description_present: "поле description в БД AppTask",
  ui_has_mockup_link: "ссылки в description/links карточки",
  ui_mockup_approved: "текст description + keyword эвристика согласования",
  ui_adaptive_requirements: "keyword/regex эвристика по description",
  ui_browser_device_requirements: "keyword/regex эвристика по description",
  act_ready_naming: "rule-based эвристика по названию карточки",
};

export function ruleVerificationMethod(ruleId: string): string {
  return (
    RULE_VERIFICATION_METHODS[ruleId] ??
    "правило профиля аудита (см. condition)"
  );
}
