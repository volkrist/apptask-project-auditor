/** Как выполняется проверка — для web/markdown отчёта (честная маркировка эвристик и источников). */
export const RULE_VERIFICATION_METHODS: Record<string, string> = {
  deadline_less_than_one_day:
    "дедлайн карточки AppTask из БД + текущий статус задачи",
  high_priority_stale:
    "история статусов AppTask + поле priority из БД",
  in_progress_stale:
    "история статусов AppTask + timestamp последнего изменения",
  review_stale:
    "история статусов AppTask + timestamp последнего изменения",
  review_queue_over_limit:
    "агрегация карточек AppTask в статусе проверки/QA на доске",
  never_started_task:
    "история статусов AppTask + дата создания карточки",
  mass_start_without_completion:
    "консервативная эвристика по активным задачам исполнителя (AppTask DB + история статусов)",
  scrum_task_in_estimate:
    "сопоставление карточки AppTask со строкой Scrum / утверждённой сметы",
  scrum_title_matches_estimate:
    "название карточки AppTask + название строки в Scrum / смете",
  scrum_planned_hours_present:
    "наличие плановой оценки (ПВ) в Scrum / смете",
  scrum_decomposition_over_20h:
    "ПВ из Scrum / сметы + структура задач AppTask",
  sprint_dates_match:
    "Scrum / майлстоуны + рабочая таблица проекта",
  actual_hours_exceeds_estimate:
    "фактическое время из tracking + ПВ из Scrum / сметы",
  estimate_exceeded_without_comment:
    "tracking + ПВ из Scrum / сметы + комментарии AppTask",
  done_task_without_tracking:
    "статус «Готово» в AppTask + сумма tracking",
  in_progress_without_recent_tracking:
    "статус «В работе» в AppTask + tracking за последний рабочий день",
  tracking_on_non_work_status:
    "сопоставление tracking со статусом карточки AppTask",
  tracking_daily_anomaly:
    "агрегация tracking по пользователю и дате",
  tracking_high_without_result:
    "tracking + keyword/regex эвристика по комментариям AppTask",
  review_stage_requires_assignee:
    "поле assignee в AppTask + статус на этапе проверки",
  verified_success_comment:
    "поиск точных фраз и аналогов («проверено», «тестирование завершено») в комментариях AppTask",
  tester_feedback_has_proof:
    "комментарии AppTask: ссылки, attachments и слова «скрин», «видео»",
  developer_active_tasks_limit:
    "подсчёт активных задач на исполнителя по статусам AppTask",
  unresolved_question_keywords_in_card:
    "keyword/regex эвристика по тексту карточки AppTask",
  open_questions_closed:
    "keyword/regex эвристика по комментариям AppTask",
  rework_without_reason:
    "keyword/regex эвристика по комментариям и истории статусов AppTask",
  vague_done_comment:
    "keyword/regex эвристика по комментариям AppTask",
  blocked_task_reason:
    "keyword/regex эвристика + комментарии AppTask (причина блокировки)",
  blocked_tag_present: "поле tags карточки AppTask из БД",
  board_name_template:
    "AppTask Boards.name + rule-based классификатор по шаблону",
  board_folder_link:
    "AppTask Boards.description / comment доски (ссылка на папку)",
  board_tz_summary:
    "AppTask Boards.description / comment доски (описание ТЗ)",
  project_worksheet_match:
    "метаданные доски AppTask + рабочая Google-таблица проекта",
  team_worksheet_match:
    "исполнители карточек AppTask + рабочая таблица проекта",
  team_discord_match:
    "исполнители карточек AppTask + список участников Discord (если доступен)",
  team_role_rate_match:
    "рабочая Google-таблица проекта (роль и ставка участников)",
  task_type_classification:
    "rule-based классификатор по названию, category/stage и flow-шаблонам AppTask",
  assignee_present: "поле assignee карточки AppTask из БД",
  blocked_assignee_not_allowed:
    "список заблокированных пользователей AppTask + assignee карточки",
  description_present: "поле description карточки AppTask из БД",
  ui_has_mockup_link:
    "ссылки в description / links карточки AppTask",
  ui_mockup_approved:
    "description карточки AppTask + keyword-эвристика согласования",
  ui_adaptive_requirements:
    "keyword/regex эвристика по description карточки AppTask",
  ui_browser_device_requirements:
    "keyword/regex эвристика по description карточки AppTask",
  act_ready_naming:
    "rule-based эвристика по названию карточки AppTask",
};

export function ruleVerificationMethod(ruleId: string): string {
  return (
    RULE_VERIFICATION_METHODS[ruleId] ??
    "правило профиля аудита (см. condition)"
  );
}
