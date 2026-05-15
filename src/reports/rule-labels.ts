/** Стабильные подписи ruleId для отчётов (русский). */
export const RULE_LABELS: Record<string, string> = {
  title_present: "Нет названия",
  title_not_generic: "Слишком общее название",
  description_present: "Нет или короткое описание",
  description_has_goal: "Нет цели в описании",
  assignee_present: "Нет исполнителя",
  deadline_present: "Нет дедлайна",
  deadline_not_overdue: "Просроченный дедлайн",
  deadline_not_in_past: "Дата начала в прошлом",
  priority_present: "Нет приоритета",
  tags_required: "Нет обязательных тегов",
  task_type_valid: "Некорректный тип задачи",
  stage_matches_column: "Этап не соответствует статусу",
  estimate_present: "Нет планового времени",
  estimate_link_present: "Нет ссылки на смету/договор",
  artifact_links_present: "Нет ссылок на артефакты",
  links_reachable: "Проблемы со ссылками",
  not_duplicate: "Возможный дубликат",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId;
}
