import { MANDATORY_CARD_FIELD_RULE_IDS } from "./audit-profiles.js";

/** Область проверки в реестре (подпись для отчёта). */
export type ContractCheckScope =
  | "task"
  | "board"
  | "project"
  | "team"
  | "sprint"
  | "user-day";

export type ContractCheckRegistryEntry = {
  /** Порядковый номер в реестре отчёта. */
  num: number;
  /** Название проверки для заказчика. */
  title: string;
  /** ruleId для подсчёта нарушений. */
  ruleIds: readonly string[];
  scope: ContractCheckScope;
};

const MANDATORY_CHECK_TITLES: Record<(typeof MANDATORY_CARD_FIELD_RULE_IDS)[number], string> = {
  title_present: "У карточки есть понятное название задачи",
  title_not_generic: "Название карточки не слишком общее",
  description_present: "У карточки есть подробное описание задачи",
  description_has_goal:
    "В описании указана цель задачи или ожидаемый результат",
  assignee_present: "У активной карточки (в работе / на проверке) указан исполнитель",
  blocked_assignee_not_allowed: "Задачи не назначены на уволенных или неактивных сотрудников",
  assignee_not_in_users_list: "Исполнитель найден в списке активных пользователей AppTask",
  deadline_present: "У карточки указан дедлайн",
  deadline_not_overdue: "Дедлайн не просрочен",
  deadline_realistic: "Дедлайн реалистичный и не установлен в прошлом",
  deadline_start_not_after_due: "Дата начала не позже дедлайна",
  priority_present: "У карточки задан приоритет",
  tags_required: "У карточки указан хотя бы один тег",
  task_type_valid: "У карточки указан тип задачи (тег: баг, доработка, дизайн и т.д.)",
  stage_matches_column: "Указан этап или воронка, соответствующий статусу задачи",
  estimate_present: "У карточки есть оценка времени или бюджета по смете",
  estimate_link_present: "Есть ссылка на смету, договор, заявку или согласование",
  links_reachable: "Все вложения и ссылки открываются и не пустые",
  not_duplicate: "Карточка не является дубликатом другой задачи",
  open_questions_closed: "На все открытые вопросы в комментариях есть ответ",
  unresolved_question_keywords_in_card:
    'Нет незакрытых вопросов с маркерами «уточнить», «обсудить», «ждём ответ», «непонятно»',
  review_stage_requires_assignee:
    "При переводе на проверку назначен тестировщик",
};

/** Блок «1. Обязательные поля карточки» — 22 проверки по ТЗ заказчика. */
export const MANDATORY_CARD_FIELD_CHECK_REGISTRY: readonly ContractCheckRegistryEntry[] =
  MANDATORY_CARD_FIELD_RULE_IDS.map((ruleId, index) => ({
    num: index + 1,
    title: MANDATORY_CHECK_TITLES[ruleId],
    ruleIds: [ruleId],
    scope: "task",
  }));

const MANDATORY_RULE_ID_SET = new Set<string>(MANDATORY_CARD_FIELD_RULE_IDS);

/** Операционные проверки (Scrum, tracking, QA, доска) без дублей обязательных полей. */
export function getOperationalCheckRegistry(): readonly ContractCheckRegistryEntry[] {
  const kept = CONTRACT_OPERATIONAL_CHECK_REGISTRY.filter(
    (entry) => !entry.ruleIds.some((id) => MANDATORY_RULE_ID_SET.has(id)),
  );
  const offset = MANDATORY_CARD_FIELD_CHECK_REGISTRY.length;
  return kept.map((entry, index) => ({
    ...entry,
    num: offset + index + 1,
  }));
}

/** Полный реестр для отчёта: обязательные поля + операционные проверки. */
export function getFullCheckRegistry(): readonly ContractCheckRegistryEntry[] {
  return [...MANDATORY_CARD_FIELD_CHECK_REGISTRY, ...getOperationalCheckRegistry()];
}

/** Операционный список (исторический порядок 1–45, без блока обязательных полей). */
export const CONTRACT_OPERATIONAL_CHECK_REGISTRY: readonly ContractCheckRegistryEntry[] = [
  { num: 1, title: "До дедлайна меньше 1 дня", ruleIds: ["deadline_less_than_one_day"], scope: "task" },
  { num: 2, title: "Задача есть в утверждённой смете", ruleIds: ["scrum_task_in_estimate"], scope: "task" },
  { num: 3, title: "Заблокированная задача имеет blocked-тег", ruleIds: ["blocked_tag_present"], scope: "task" },
  { num: 4, title: "Заблокированная задача имеет причину блокировки", ruleIds: ["blocked_task_reason"], scope: "task" },
  { num: 5, title: "Задача содержит описание из ТЗ", ruleIds: ["description_present"], scope: "task" },
  { num: 6, title: "Задачи >20 часов декомпозированы", ruleIds: ["scrum_decomposition_over_20h"], scope: "task" },
  {
    num: 7,
    title: "Название и описание проекта сверены с рабочей таблицей",
    ruleIds: ["project_worksheet_match"],
    scope: "project",
  },
  {
    num: 8,
    title: "Состав команды сверен с рабочей таблицей и Discord",
    ruleIds: ["team_worksheet_match"],
    scope: "team",
  },
  {
    num: 9,
    title: "Роль и ставка сверены с рабочей таблицей",
    ruleIds: ["team_role_rate_match"],
    scope: "team",
  },
  {
    num: 10,
    title: "Даты и названия спринтов сверены со Scrum",
    ruleIds: ["sprint_dates_match"],
    scope: "sprint",
  },
  {
    num: 11,
    title: "Разделение на типы задач",
    ruleIds: ["task_type_classification"],
    scope: "task",
  },
  { num: 12, title: "Названия задач сверены со сметой", ruleIds: ["scrum_title_matches_estimate"], scope: "task" },
  { num: 13, title: "ПВ указано в Scrum", ruleIds: ["scrum_planned_hours_present"], scope: "task" },
  { num: 14, title: "High priority / critical bug без движения >24 часов", ruleIds: ["high_priority_stale"], scope: "task" },
  { num: 15, title: "В работе без обновлений >2 рабочих дней", ruleIds: ["in_progress_stale"], scope: "task" },
  { num: 16, title: "На проверке без движения >2 рабочих дней", ruleIds: ["review_stale"], scope: "task" },
  { num: 17, title: "Перегруз QA", ruleIds: ["review_queue_over_limit"], scope: "task" },
  { num: 18, title: "Задача без исполнителя", ruleIds: ["assignee_present"], scope: "task" },
  { num: 19, title: "UI-задача имеет ссылку на макет", ruleIds: ["ui_has_mockup_link"], scope: "task" },
  { num: 20, title: "Макет согласован", ruleIds: ["ui_mockup_approved"], scope: "task" },
  { num: 21, title: "Есть требования к адаптивности", ruleIds: ["ui_adaptive_requirements"], scope: "task" },
  { num: 22, title: "Есть требования к браузерам/устройствам", ruleIds: ["ui_browser_device_requirements"], scope: "task" },
  { num: 23, title: "Нет активных задач без трекинга", ruleIds: ["in_progress_without_recent_tracking"], scope: "task" },
  { num: 24, title: "Нет трекинга вне рабочего статуса", ruleIds: ["tracking_on_non_work_status"], scope: "task" },
  { num: 25, title: "Факт не превышает ПВ больше чем на 20%", ruleIds: ["actual_hours_exceeds_estimate"], scope: "task" },
  { num: 26, title: "При превышении ПВ есть комментарий", ruleIds: ["estimate_exceeded_without_comment"], scope: "task" },
  { num: 27, title: "Нет аномального списания за день", ruleIds: ["tracking_daily_anomaly"], scope: "user-day" },
  { num: 28, title: "Нет готовых задач с нулевым трекингом", ruleIds: ["done_task_without_tracking"], scope: "task" },
  { num: 29, title: "Нет большого трекинга без результата/комментариев", ruleIds: ["tracking_high_without_result"], scope: "task" },
  { num: 30, title: "У разработчика не больше 3 активных задач", ruleIds: ["developer_active_tasks_limit"], scope: "task" },
  { num: 31, title: "Очередь QA не больше 10 задач", ruleIds: ["review_queue_over_limit"], scope: "task" },
  { num: 32, title: "Нет массового старта задач без завершения старых", ruleIds: ["mass_start_without_completion"], scope: "task" },
  { num: 33, title: 'После успешной проверки есть комментарий "проверено"', ruleIds: ["verified_success_comment"], scope: "task" },
  { num: 34, title: "Замечания тестировщика имеют скрин/видео/ссылку", ruleIds: ["tester_feedback_has_proof"], scope: "task" },
  { num: 35, title: "При возврате на доработку есть причина", ruleIds: ["rework_without_reason"], scope: "task" },
  { num: 36, title: 'Нет комментариев "готово/сделал/проверь" без деталей', ruleIds: ["vague_done_comment"], scope: "task" },
  { num: 37, title: "Давно созданные задачи брались в работу", ruleIds: ["never_started_task"], scope: "task" },
  { num: 38, title: "Название доски по шаблону", ruleIds: ["board_name_template"], scope: "board" },
  { num: 39, title: "В описании доски есть ссылка на папку проекта", ruleIds: ["board_folder_link"], scope: "board" },
  { num: 40, title: "В описании доски есть краткое описание проекта из ТЗ", ruleIds: ["board_tz_summary"], scope: "board" },
  {
    num: 41,
    title: "Открытые вопросы в комментариях закрыты",
    ruleIds: ["open_questions_closed"],
    scope: "task",
  },
  {
    num: 42,
    title: 'Нет незакрытых вопросов "уточнить/обсудить/ждем ответ/непонятно"',
    ruleIds: ["unresolved_question_keywords_in_card"],
    scope: "task",
  },
  { num: 43, title: "На проверке назначен тестировщик", ruleIds: ["review_stage_requires_assignee"], scope: "task" },
  { num: 44, title: "Нет задач на уволенных/неактивных сотрудниках", ruleIds: ["blocked_assignee_not_allowed"], scope: "task" },
  { num: 45, title: "Названия задач и время готовы к актам", ruleIds: ["act_ready_naming"], scope: "task" },
];

/** @deprecated Используйте getFullCheckRegistry() для отчётов. */
export const CONTRACT_CHECK_REGISTRY = CONTRACT_OPERATIONAL_CHECK_REGISTRY;
