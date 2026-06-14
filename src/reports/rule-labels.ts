/** Стабильные подписи ruleId для отчётов (русский). */
export const RULE_LABELS: Record<string, string> = {
  title_present: "Некорректное или короткое название",
  title_not_generic: "Слишком общее название",
  description_present: "Нет или короткое описание",
  description_has_goal: "Нет цели в описании",
  assignee_present: "Нет исполнителя",
  blocked_assignee_not_allowed:
    "Задача не назначена на заблокированного/неактивного пользователя",
  assignee_not_in_users_list:
    "Исполнитель найден в списке пользователей AppTask",
  deadline_present: "Нет дедлайна",
  deadline_not_overdue: "Просроченный дедлайн",
  deadline_start_not_after_due: "Дата начала позже дедлайна",
  deadline_realistic: "Нереалистичный срок",
  priority_present: "Нет приоритета",
  tags_required: "Обязательные теги",
  task_type_valid: "Некорректный тип задачи",
  stage_matches_column: "Этап не соответствует статусу",
  estimate_present: "Нет оценки времени/бюджета",
  estimate_link_present: "Нет ссылки на смету/договор",
  artifact_links_present: "Нет ссылок на артефакты",
  links_reachable: "Проблемы со ссылками",
  not_duplicate: "Возможный дубликат",
  unresolved_question_keywords_in_card:
    "Есть признак незакрытого вопроса",
  review_stage_requires_assignee:
    "На этапе проверки назначен тестировщик",
  scrum_task_in_estimate: "Задача не найдена в утверждённой смете",
  scrum_title_matches_estimate: "Название не совпадает со сметой",
  scrum_planned_hours_present: "ПВ из сметы не указано в Scrum-портале",
  scrum_decomposition_over_20h: "Задача >20 ч без декомпозиции",
  deadline_less_than_one_day: "До дедлайна меньше суток",
  blocked_task_reason: "Блокировка без причины",
  review_queue_over_limit: "Очередь на тестирование > лимита",
  in_progress_stale: "В процессе без обновлений",
  review_stale: "На проверке без движения",
  vague_done_comment: "Комментарий «готово» без деталей",
  high_priority_stale: "Высокий приоритет без движения",
  rework_without_reason: "Возврат на доработку без причины",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId;
}
