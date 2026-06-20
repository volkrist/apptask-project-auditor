/** Область проверки в реестре (подпись для отчёта). */
export type ContractCheckScope =
  | "task"
  | "board"
  | "project"
  | "team"
  | "sprint"
  | "user-day";

export type ContractCheckRegistryEntry = {
  /** Порядковый номер в контрактном списке (1–46). */
  num: number;
  /** Название проверки для заказчика. */
  title: string;
  /** ruleId для подсчёта нарушений. */
  ruleIds: readonly string[];
  scope: ContractCheckScope;
};

/** Контрактный список проверок (порядок фиксирован). */
export const CONTRACT_CHECK_REGISTRY: readonly ContractCheckRegistryEntry[] = [
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
    title: "Состав команды сверен с рабочей таблицей",
    ruleIds: ["team_worksheet_match"],
    scope: "team",
  },
  {
    num: 9,
    title: "Состав команды сверен с Discord",
    ruleIds: ["team_discord_match"],
    scope: "team",
  },
  {
    num: 10,
    title: "Роль и ставка сверены с рабочей таблицей",
    ruleIds: ["team_role_rate_match"],
    scope: "team",
  },
  {
    num: 11,
    title: "Даты и названия спринтов сверены со Scrum",
    ruleIds: ["sprint_dates_match"],
    scope: "sprint",
  },
  {
    num: 12,
    title: "Разделение на типы задач",
    ruleIds: ["task_type_classification"],
    scope: "task",
  },
  { num: 13, title: "Названия задач сверены со сметой", ruleIds: ["scrum_title_matches_estimate"], scope: "task" },
  { num: 14, title: "ПВ указано в Scrum", ruleIds: ["scrum_planned_hours_present"], scope: "task" },
  { num: 15, title: "High priority / critical bug без движения >24 часов", ruleIds: ["high_priority_stale"], scope: "task" },
  { num: 16, title: "В работе без обновлений >2 рабочих дней", ruleIds: ["in_progress_stale"], scope: "task" },
  { num: 17, title: "На проверке без движения >1 рабочего дня", ruleIds: ["review_stale"], scope: "task" },
  { num: 18, title: "Перегруз QA", ruleIds: ["review_queue_over_limit"], scope: "task" },
  { num: 19, title: "Задача без исполнителя", ruleIds: ["assignee_present"], scope: "task" },
  { num: 20, title: "UI-задача имеет ссылку на макет", ruleIds: ["ui_has_mockup_link"], scope: "task" },
  { num: 21, title: "Макет согласован", ruleIds: ["ui_mockup_approved"], scope: "task" },
  { num: 22, title: "Есть требования к адаптивности", ruleIds: ["ui_adaptive_requirements"], scope: "task" },
  { num: 23, title: "Есть требования к браузерам/устройствам", ruleIds: ["ui_browser_device_requirements"], scope: "task" },
  { num: 24, title: "Нет активных задач без трекинга", ruleIds: ["in_progress_without_recent_tracking"], scope: "task" },
  { num: 25, title: "Нет трекинга вне рабочего статуса", ruleIds: ["tracking_on_non_work_status"], scope: "task" },
  { num: 26, title: "Факт не превышает ПВ больше чем на 20%", ruleIds: ["actual_hours_exceeds_estimate"], scope: "task" },
  { num: 27, title: "При превышении ПВ есть комментарий", ruleIds: ["estimate_exceeded_without_comment"], scope: "task" },
  { num: 28, title: "Нет аномального списания за день", ruleIds: ["tracking_daily_anomaly"], scope: "user-day" },
  { num: 29, title: "Нет готовых задач с нулевым трекингом", ruleIds: ["done_task_without_tracking"], scope: "task" },
  { num: 30, title: "Нет большого трекинга без результата/комментариев", ruleIds: ["tracking_high_without_result"], scope: "task" },
  { num: 31, title: "У разработчика не больше 3 активных задач", ruleIds: ["developer_active_tasks_limit"], scope: "task" },
  { num: 32, title: "Очередь QA не больше 10 задач", ruleIds: ["review_queue_over_limit"], scope: "task" },
  { num: 33, title: "Нет массового старта задач без завершения старых", ruleIds: ["mass_start_without_completion"], scope: "task" },
  { num: 34, title: 'После успешной проверки есть комментарий "проверено"', ruleIds: ["verified_success_comment"], scope: "task" },
  { num: 35, title: "Замечания тестировщика имеют скрин/видео/ссылку", ruleIds: ["tester_feedback_has_proof"], scope: "task" },
  { num: 36, title: "При возврате на доработку есть причина", ruleIds: ["rework_without_reason"], scope: "task" },
  { num: 37, title: 'Нет комментариев "готово/сделал/проверь" без деталей', ruleIds: ["vague_done_comment"], scope: "task" },
  { num: 38, title: "Давно созданные задачи брались в работу", ruleIds: ["never_started_task"], scope: "task" },
  { num: 39, title: "Название доски по шаблону", ruleIds: ["board_name_template"], scope: "board" },
  { num: 40, title: "В описании доски есть ссылка на папку проекта", ruleIds: ["board_folder_link"], scope: "board" },
  { num: 41, title: "В описании доски есть краткое описание проекта из ТЗ", ruleIds: ["board_tz_summary"], scope: "board" },
  {
    num: 42,
    title: "Открытые вопросы в комментариях закрыты",
    ruleIds: ["open_questions_closed"],
    scope: "task",
  },
  {
    num: 43,
    title: 'Нет незакрытых вопросов "уточнить/обсудить/ждем ответ/непонятно"',
    ruleIds: ["unresolved_question_keywords_in_card"],
    scope: "task",
  },
  { num: 44, title: "На проверке назначен тестировщик", ruleIds: ["review_stage_requires_assignee"], scope: "task" },
  { num: 45, title: "Нет задач на уволенных/неактивных сотрудниках", ruleIds: ["blocked_assignee_not_allowed"], scope: "task" },
  { num: 46, title: "Названия задач и время готовы к актам", ruleIds: ["act_ready_naming"], scope: "task" },
];
