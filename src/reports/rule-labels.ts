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
    "В карточке нет признаков незакрытого вопроса",
  review_stage_requires_assignee:
    "На этапе проверки назначен тестировщик",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId;
}
