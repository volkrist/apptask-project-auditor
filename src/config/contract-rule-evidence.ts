import {
  CONTRACT_OPERATIONAL_CHECK_REGISTRY,
  getFullCheckRegistry,
  getOperationalCheckRegistry,
  MANDATORY_CARD_FIELD_CHECK_REGISTRY,
} from "./contract-check-registry.js";
import type { AutomationLevel } from "../rules/evidence-types.js";

export type ContractRuleEvidenceSpec = {
  num: number;
  title: string;
  ruleIds: readonly string[];
  sources: string;
  scope: string;
  candidates: string;
  violation: string;
  passed: string;
  notChecked: string;
  outcomeOK: string;
  outcomePartial: string;
  outcomeSkip: string;
  automationLevel: AutomationLevel;
  /** «да» | «частично» | «нет» — можно ли доказать автоматически. */
  autoProvable: string;
  /** Подсказка для формулировок в отчёте при не-STRICT уровне. */
  reportWording?: string;
};

function mandatoryFieldEvidence(
  violation: string,
  passed: string,
  overrides: Partial<{
    sources: string;
    scope: string;
    candidates: string;
    notChecked: string;
    automationLevel: AutomationLevel;
    autoProvable: string;
  }> = {},
): Omit<ContractRuleEvidenceSpec, "num" | "title" | "ruleIds"> {
  return {
    sources: overrides.sources ?? "AppTask DB / API: поля карточки",
    scope: overrides.scope ?? "task-level карточки (исключены потоковые)",
    candidates: overrides.candidates ?? "все проверенные карточки",
    violation,
    passed,
    notChecked: overrides.notChecked ?? "—",
    outcomeOK: "нарушений нет",
    outcomePartial: "—",
    outcomeSkip: "источник недоступен",
    automationLevel: overrides.automationLevel ?? "STRICT",
    autoProvable: overrides.autoProvable ?? "да",
  };
}

const MANDATORY_EVIDENCE_BY_RULE: Record<
  string,
  Omit<ContractRuleEvidenceSpec, "num" | "title" | "ruleIds">
> = {
  title_present: mandatoryFieldEvidence(
    "название пустое, слишком короткое или без конкретики",
    "название заполнено и достаточно конкретное",
  ),
  title_not_generic: mandatoryFieldEvidence(
    "название из списка общих слов (правки, доработки, баги и т.п.)",
    "название не является слишком общим",
  ),
  description_present: mandatoryFieldEvidence(
    "описание пустое или короче порога (80 символов)",
    "описание заполнено",
  ),
  description_has_goal: mandatoryFieldEvidence(
    "в тексте описания (content) нет фразы «цель задачи» или «ожидаемый результат» и нет заголовка «Цель» в начале секции",
    "цель задачи или ожидаемый результат указаны явно в описании",
    { automationLevel: "STRICT", autoProvable: "да" },
  ),
  assignee_present: mandatoryFieldEvidence(
    "задача в работе или на проверке без назначенного исполнителя",
    "исполнитель указан",
    {
      candidates: "карточки в статусе «В процессе» или «На проверке»",
    },
  ),
  blocked_assignee_not_allowed: mandatoryFieldEvidence(
    "исполнитель заблокирован в AppTask (Users.blocked)",
    "исполнитель активен",
    {
      sources: "AppTask DB: BoardTaskUsers + Users.blocked",
      notChecked: "список пользователей не загружен",
      automationLevel: "STRICT",
      autoProvable: "да",
    },
  ),
  assignee_not_in_users_list: mandatoryFieldEvidence(
    "исполнитель не найден в списке пользователей",
    "исполнитель найден в users",
    {
      sources: "AppTask DB: Users; API get_users при playwright/api",
      notChecked: "список пользователей не загружен",
      automationLevel: "PARTIAL",
      autoProvable: "частично",
    },
  ),
  deadline_present: mandatoryFieldEvidence(
    "дедлайн не указан",
    "дедлайн указан",
    { sources: "AppTask DB: dueDate" },
  ),
  deadline_not_overdue: mandatoryFieldEvidence(
    "дедлайн просрочен при незавершённой задаче",
    "дедлайн не просрочен",
    { sources: "AppTask DB: dueDate, status" },
  ),
  deadline_realistic: mandatoryFieldEvidence(
    "дедлайн в прошлом или нереалистичен",
    "дедлайн реалистичен",
    { sources: "AppTask DB: dueDate, startDate" },
  ),
  deadline_start_not_after_due: mandatoryFieldEvidence(
    "дата начала позже дедлайна",
    "даты начала и дедлайна согласованы",
    { sources: "AppTask DB: startDate, dueDate" },
  ),
  priority_present: mandatoryFieldEvidence(
    "приоритет не задан",
    "приоритет указан",
    { sources: "AppTask DB: priority" },
  ),
  tags_required: mandatoryFieldEvidence(
    "теги не указаны или отсутствуют обязательные теги из REQUIRED_TAGS",
    "у карточки есть теги",
    {
      sources: "AppTask DB: tags; REQUIRED_TAGS в .env — дополнительный список",
      candidates: "все проверенные карточки",
    },
  ),
  task_type_valid: mandatoryFieldEvidence(
    "нет тега с типом задачи из допустимого списка",
    "тип задачи указан тегом",
    {
      sources: "AppTask DB: BoardTaskTags; список типов — audit-config.ts requiredTaskTypes",
      candidates: "все проверенные карточки",
    },
  ),
  stage_matches_column: mandatoryFieldEvidence(
    "этап не указан, дублирует статус колонки или не содержит маркеров для текущего статуса",
    "этап/воронка соответствует статусу",
    {
      sources:
        "AppTask: «Этап» (Playwright) или BoardSprints.name (DB); boardStageByStatus для доски 783",
      automationLevel: "PARTIAL",
      autoProvable: "частично",
    },
  ),
  estimate_present: mandatoryFieldEvidence(
    "нет ПВ в карточке, ссылки на смету и ПВ в Google-смете",
    "оценка времени или бюджет по смете указаны",
    {
      sources:
        "AppTask DB: planned_end_time_offset; описание/ссылки; Scrum/Google Sheets",
    },
  ),
  estimate_link_present: mandatoryFieldEvidence(
    "нет ссылки или упоминания сметы/договора/заявки/согласования в описании и ссылках карточки",
    "ссылка на смету или договор указана в карточке",
    {
      sources:
        "AppTask DB: content/links; ПВ в карточке и строка Google-сметы без ссылки в карточке не засчитываются",
    },
  ),
  artifact_links_present: mandatoryFieldEvidence(
    "нет ссылок на макет, ТЗ, репозиторий, документацию или строки в смете",
    "артефакт найден (макет, ТЗ, документация, репозиторий, заявка или смета)",
    {
      sources:
        "AppTask DB: content/links; Scrum/Google Sheets (строка задачи в смете)",
    },
  ),
  links_reachable: mandatoryFieldEvidence(
    "ссылка или вложение недоступно / пустое",
    "все ссылки доступны (HTTP 2xx/3xx)",
    {
      sources: "AppTask DB: content/links; HTTP-проверка",
      notChecked: "HTTP-проверка отключена (LINK_CHECK_ENABLED=false) или нет ссылок",
      automationLevel: "PARTIAL",
      autoProvable: "частично",
    },
  ),
  not_duplicate: mandatoryFieldEvidence(
    "найдена похожая задача на той же доске",
    "дубликатов не обнаружено",
    { automationLevel: "PARTIAL", autoProvable: "частично" },
  ),
  open_questions_closed: mandatoryFieldEvidence(
    "вопрос в комментариях без ответа в треде и без ответа другого участника",
    "на все вопросы есть ответ",
    {
      sources: "AppTask DB: comments (текст, parent_id, автор, время)",
      automationLevel: "TEXT_MARKER",
      autoProvable: "частично",
    },
  ),
  unresolved_question_keywords_in_card: mandatoryFieldEvidence(
    "в тексте карточки есть маркеры незакрытого вопроса",
    "признаков незакрытого вопроса нет",
    {
      sources: "AppTask DB: title, description, comments",
      automationLevel: "TEXT_MARKER",
      autoProvable: "частично",
    },
  ),
  review_stage_requires_assignee: mandatoryFieldEvidence(
    "на этапе проверки не назначен тестировщик",
    "тестировщик назначен",
    { sources: "AppTask DB: assignee + status (review/QA)" },
  ),
};

/** Статусы, распознаваемые как QA / review (см. также TESTING_STATUS_RE). */
export const REVIEW_STATUS_ALIASES = [
  "На проверке",
  "Проверить тестировщику",
  "QA",
  "Review",
  "Тестирование",
  "Проверка",
  "testing",
  "review",
  "qa",
] as const;

const EVIDENCE_BY_NUM: Record<number, Omit<ContractRuleEvidenceSpec, "num" | "title" | "ruleIds">> = {
  1: {
    sources: "AppTask DB: deadline/dueDate, status",
    scope: "активные task-level карточки (не потоковые)",
    candidates: "не завершены; дедлайн задан; до дедлайна < 24 ч",
    violation: "candidate не завершён и дедлайн < 24 ч (WARN) или просрочен (FAIL)",
    passed: "candidates без нарушения (нет таких задач в зоне < 24 ч)",
    notChecked: "—",
    outcomeOK: "candidates = 0 → «Кандидатов для проверки нет»; не писать «64 кандидатов»",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  2: {
    sources: "AppTask task id/title; Scrum / утверждённая смета",
    scope: "task-level карточки",
    candidates: "все карточки при доступной смете",
    violation: "задача не найдена в утверждённой смете",
    passed: "задача найдена в смете",
    notChecked: "Scrum / смета недоступна",
    outcomeOK: "все задачи в смете",
    outcomePartial: "—",
    outcomeSkip: "смета не загружена",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  3: {
    sources: "AppTask tags, status/stage (blocked)",
    scope: "заблокированные task-level карточки",
    candidates: "статус/этап содержит blocked / блокер",
    violation: "нет тега blocked/блок",
    passed: "тег blocked присутствует",
    notChecked: "—",
    outcomeOK: "0 заблокированных → «Кандидатов для проверки нет»",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  4: {
    sources: "AppTask comments, status (blocked)",
    scope: "заблокированные task-level карточки",
    candidates: "заблокированные задачи",
    violation: "нет причины блокировки в комментариях (фиксированные маркеры)",
    passed: "есть комментарий с причиной",
    notChecked: "—",
    outcomeOK: "0 заблокированных",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по фиксированным маркерам причины блокировки",
  },
  5: {
    sources: "AppTask descriptionText",
    scope: "task-level карточки",
    candidates: "все карточки",
    violation: "описание пустое или короче порога (80 символов)",
    passed: "описание заполнено",
    notChecked: "—",
    outcomeOK: "все с описанием",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  6: {
    sources: "Scrum ПВ; структура подзадач AppTask",
    scope: "task-level карточки с ПВ > 20 ч в смете",
    candidates: "строки сметы с ПВ > 20 ч",
    violation: "нет декомпозиции (подзадач / дочерних)",
    passed: "декомпозировано",
    notChecked: "строка не в смете или Scrum недоступен",
    outcomeOK: "0 задач с ПВ > 20 ч",
    outcomePartial: "часть задач без строки сметы",
    outcomeSkip: "Scrum недоступен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  7: {
    sources: "AppTask project metadata; Google Sheet / рабочая таблица",
    scope: "проект (entity-level)",
    candidates: "один проект",
    violation: "расхождение названия или описания с таблицей",
    passed: "совпадает с таблицей",
    notChecked: "таблица недоступна",
    outcomeOK: "совпадение",
    outcomePartial: "—",
    outcomeSkip: "таблица не загружена",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  8: {
    sources: "AppTask users; Google Sheet; Discord guild (опционально)",
    scope: "команда проекта (entity-level)",
    candidates: "участники AppTask vs таблица (+ Discord подисточник)",
    violation: "участник есть в одном источнике, нет в другом",
    passed: "состав совпадает",
    notChecked: "Discord недоступен → подисточник SKIP",
    outcomeOK: "состав совпадает",
    outcomePartial: "Discord не проверен, таблица проверена",
    outcomeSkip: "таблица недоступна",
    automationLevel: "PARTIAL",
    autoProvable: "частично",
    reportWording: "Discord — отдельный подисточник; при недоступности не FAIL",
  },
  9: {
    sources: "AppTask assignees; Google Sheet (роль, ставка)",
    scope: "исполнители из рабочей таблицы",
    candidates: "участники, найденные в таблице",
    violation: "роль или ставка не совпадает",
    passed: "роль и ставка совпадают",
    notChecked: "исполнитель не найден в таблице (роль/ставку сверить нельзя)",
    outcomeOK: "все в таблице совпали",
    outcomePartial: "есть исполнители без строки в таблице → WARN + «Не проверено»",
    outcomeSkip: "таблица недоступна",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  10: {
    sources: "AppTask sprints; Scrum sprint dates",
    scope: "спринты проекта (entity-level)",
    candidates: "спринты в AppTask и Scrum",
    violation: "расхождение дат или названий",
    passed: "даты и названия совпадают",
    notChecked: "Scrum недоступен",
    outcomeOK: "совпадение",
    outcomePartial: "—",
    outcomeSkip: "Scrum не загружен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  11: {
    sources: "AppTask tags, category, title, description",
    scope: "task-level карточки",
    candidates: "все карточки",
    violation: "тип не определён или не из allowed list",
    passed: "тип классифицирован",
    notChecked: "—",
    outcomeOK: "все классифицированы",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  12: {
    sources: "AppTask title; Scrum / смета",
    scope: "task-level карточки в смете",
    candidates: "задачи с найденной строкой сметы",
    violation: "название AppTask ≠ смета",
    passed: "названия совпадают",
    notChecked: "строка сметы не найдена",
    outcomeOK: "совпадения",
    outcomePartial: "часть без строки сметы",
    outcomeSkip: "Scrum недоступен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  13: {
    sources: "AppTask task id/title; Scrum / смета (ПВ)",
    scope: "task-level карточки",
    candidates: "задачи, найденные в Scrum / смете",
    violation: "строка сметы найдена, но ПВ пустое / 0",
    passed: "ПВ указано",
    notChecked: "задача не найдена в смете (ПВ не проверялось)",
    outcomeOK: "все в смете с ПВ",
    outcomePartial: "notChecked > 0 → PARTIAL + кнопка «Не проверено: N»",
    outcomeSkip: "Scrum / смета недоступна",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  14: {
    sources: "AppTask priority, status, activity/history",
    scope: "task-level high priority / critical bug",
    candidates: "high priority или critical bug, не завершены",
    violation: "нет движения > 24 ч",
    passed: "есть активность",
    notChecked: "—",
    outcomeOK: "0 high priority / critical bug",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  15: {
    sources: "AppTask status, comments, history",
    scope: "task-level «в работе»",
    candidates: "статус «в процессе / в работе», не завершены",
    violation: "нет обновлений > 2 рабочих дней",
    passed: "есть недавняя активность",
    notChecked: "—",
    outcomeOK: "0 задач в работе без обновлений",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  16: {
    sources: "AppTask DB current status; status history",
    scope: "task-level карточки",
    candidates: "текущий статус ∈ review/QA aliases",
    violation: "candidate без движения > 2 рабочих дней",
    passed: "есть движение или срок не превышен",
    notChecked: "—",
    outcomeOK: "candidates = 0 → показать aliases + распределение статусов + «текущих на проверке: 0»",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  17: {
    sources: "AppTask board metrics (очередь QA)",
    scope: "доска / агрегат",
    candidates: "текущая очередь на проверке",
    violation: "очередь > лимита (10)",
    passed: "очередь в пределах лимита",
    notChecked: "—",
    outcomeOK: "0 задач на проверке или ≤ лимита",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  18: {
    sources: "AppTask assignees",
    scope: "активные task-level карточки",
    candidates: "карточки без исполнителя",
    violation: "исполнитель не назначен",
    passed: "исполнитель есть",
    notChecked: "—",
    outcomeOK: "0 без исполнителя",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  19: {
    sources: "AppTask description links; классификация UI/front; исключение задач на дизайн/макет",
    scope: "UI/front task-level на вёрстку/реализацию (не создание макета)",
    candidates: "UI/front задачи на реализацию по готовому макету",
    violation: "нет ссылки на готовый макет (Figma)",
    passed: "ссылка на макет есть",
    notChecked: "задачи на создание макета/дизайна",
    outcomeOK: "0 задач на вёрстку или все с макетом",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  20: {
    sources: "AppTask description / comments",
    scope: "UI/front task-level на вёрстку (не создание макета)",
    candidates: "UI/front на реализацию с макетом",
    violation: "нет маркера согласования макета",
    passed: "макет согласован (маркер найден)",
    notChecked: "задачи на создание макета/дизайна",
    outcomeOK: "маркеры согласования найдены или 0 UI задач",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по фиксированным маркерам согласования",
  },
  21: {
    sources: "AppTask description / comments",
    scope: "UI/front task-level карточки",
    candidates: "UI/front задачи",
    violation: "нет требований к адаптивности",
    passed: "требования найдены",
    notChecked: "—",
    outcomeOK: "0 UI задач или требования есть",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по ключевым словам адаптивности",
  },
  22: {
    sources: "AppTask description / comments",
    scope: "UI/front task-level карточки",
    candidates: "UI/front задачи",
    violation: "нет требований к браузерам/устройствам",
    passed: "требования найдены",
    notChecked: "—",
    outcomeOK: "0 UI задач или требования есть",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по ключевым словам браузеров/устройств",
  },
  23: {
    sources: "AppTask status; tracking DB",
    scope: "активные «в работе» task-level",
    candidates: "в работе без трекинга за последние N ч",
    violation: "нет недавнего трекинга",
    passed: "трекинг есть",
    notChecked: "tracking недоступен",
    outcomeOK: "все в работе с трекингом",
    outcomePartial: "—",
    outcomeSkip: "tracking не загружен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  24: {
    sources: "AppTask status; tracking DB (24 ч)",
    scope: "task-level карточки",
    candidates: "задачи с трекингом за 24 ч",
    violation: "трекинг вне рабочего статуса",
    passed: "трекинг только в рабочем статусе",
    notChecked: "tracking недоступен",
    outcomeOK: "0 записей трекинга за 24 ч",
    outcomePartial: "—",
    outcomeSkip: "tracking не загружен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  25: {
    sources: "Tracking факт; Scrum ПВ",
    scope: "task-level с ПВ в смете",
    candidates: "задачи с фактом и ПВ",
    violation: "факт > ПВ + 20%",
    passed: "факт в пределах",
    notChecked: "нет ПВ или tracking",
    outcomeOK: "нет превышений",
    outcomePartial: "часть без ПВ",
    outcomeSkip: "источник недоступен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  26: {
    sources: "Tracking факт; Scrum ПВ; AppTask comments",
    scope: "задачи с превышением ПВ",
    candidates: "превышение ПВ > порога",
    violation: "нет комментария-объяснения",
    passed: "комментарий есть",
    notChecked: "—",
    outcomeOK: "0 превышений или все с комментарием",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "превышение — STRICT; комментарий — по маркерам",
  },
  27: {
    sources: "Tracking DB (user-day aggregate)",
    scope: "user-day (включая потоковые в факте)",
    candidates: "дни с суммарным списанием > лимита",
    violation: "аномальное списание за день",
    passed: "в пределах лимита",
    notChecked: "tracking недоступен",
    outcomeOK: "анomalies = 0",
    outcomePartial: "—",
    outcomeSkip: "tracking не загружен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  28: {
    sources: "AppTask status; tracking факт",
    scope: "завершённые task-level",
    candidates: "завершённые задачи",
    violation: "фактическое время = 0",
    passed: "факт > 0",
    notChecked: "tracking недоступен",
    outcomeOK: "нет завершённых с нулевым трекингом",
    outcomePartial: "—",
    outcomeSkip: "tracking не загружен",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  29: {
    sources: "Tracking DB; AppTask comments / status",
    scope: "task-level с большим трекингом",
    candidates: "трекинг > порога без результата",
    violation: "нет комментария/результата",
    passed: "есть результат или комментарий",
    notChecked: "—",
    outcomeOK: "0 кандидатов",
    outcomePartial: "—",
    outcomeSkip: "tracking недоступен",
    automationLevel: "PARTIAL",
    autoProvable: "частично",
    reportWording: "«результат» определяется по статусу и комментариям",
  },
  30: {
    sources: "AppTask status, assignees",
    scope: "разработчики (агрегат по исполнителю)",
    candidates: "исполнители с активными задачами в работе",
    violation: "> 3 активных задач",
    passed: "≤ 3 активных",
    notChecked: "—",
    outcomeOK: "0 исполнителей с превышением",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  31: {
    sources: "AppTask board metrics (очередь QA)",
    scope: "доска / агрегат (дубликат №17 для контракта)",
    candidates: "текущая очередь на проверке",
    violation: "очередь > 10",
    passed: "очередь ≤ 10",
    notChecked: "—",
    outcomeOK: "0 на проверке или ≤ 10",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  32: {
    sources: "AppTask status history, assignees",
    scope: "исполнители (агрегат)",
    candidates: "исполнители с недавним массовым стартом",
    violation: "старт новых без завершения старых",
    passed: "нет массового старта",
    notChecked: "—",
    outcomeOK: "0 исполнителей в зоне проверки",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  33: {
    sources: "AppTask comments; status history",
    scope: "завершённые после успешной проверки",
    candidates: "завершённые с историей проверки",
    violation: "нет комментария «проверено»",
    passed: "комментарий найден",
    notChecked: "—",
    outcomeOK: "0 завершённых без «проверено»",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по маркеру «проверено»",
  },
  34: {
    sources: "AppTask comments (замечания тестировщика)",
    scope: "карточки с rework / замечаниями QA",
    candidates: "комментарии-требования доработки",
    violation: "нет скрина/видео/ссылки",
    passed: "доказательство есть",
    notChecked: "—",
    outcomeOK: "0 замечаний без proof",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "proof — по URL/вложениям в комментарии",
  },
  35: {
    sources: "AppTask status history; comments",
    scope: "переходы на доработку",
    candidates: "переходы review → in progress / rework",
    violation: "нет причины в комментарии",
    passed: "причина указана",
    notChecked: "—",
    outcomeOK: "0 rework без причины",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "причина — по маркерам в комментарии",
  },
  36: {
    sources: "AppTask comments",
    scope: "task-level карточки",
    candidates: "комментарии с маркерами «готово/сделал/проверь»",
    violation: "маркер без деталей",
    passed: "детали есть или маркеров нет",
    notChecked: "—",
    outcomeOK: "0 найденных маркеров",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по фиксированным маркерам vague done",
  },
  37: {
    sources: "AppTask createdAt; status history",
    scope: "task-level карточки",
    candidates: "созданы > N дней назад, не завершены, не брались в работу",
    violation: "никогда не переходили в работу",
    passed: "были в работе",
    notChecked: "—",
    outcomeOK: "0 старых без старта",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  38: {
    sources: "AppTask board metadata",
    scope: "доска (entity-level)",
    candidates: "название доски",
    violation: "не соответствует шаблону",
    passed: "шаблон соблюдён",
    notChecked: "метаданные доски недоступны",
    outcomeOK: "шаблон OK",
    outcomePartial: "—",
    outcomeSkip: "метаданные недоступны",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  39: {
    sources: "AppTask board description",
    scope: "доска (entity-level)",
    candidates: "описание доски",
    violation: "нет ссылки на папку проекта",
    passed: "ссылка есть",
    notChecked: "—",
    outcomeOK: "ссылка найдена",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  40: {
    sources: "AppTask board description",
    scope: "доска (entity-level)",
    candidates: "описание доски",
    violation: "нет краткого описания из ТЗ",
    passed: "описание достаточной длины",
    notChecked: "—",
    outcomeOK: "описание OK",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  41: {
    sources: "AppTask comments",
    scope: "комментарии task-level карточек",
    candidates: "комментарии с «?» или маркерами вопроса (вопрос, уточнить, обсудить, ждем ответ, непонятно)",
    violation: "вопрос-кандидат без ответа в треде и без ответа другого участника",
    passed: "ответ в треде или от другого участника; либо нет вопросов-кандидатов",
    notChecked: "невозможно связать вопрос и ответ (автор/время)",
    outcomeOK: "0 вопросов-кандидатов → «по найденным маркерам не найдено»",
    outcomePartial: "связь вопрос→ответ неполная → PARTIAL, не уверенный OK",
    outcomeSkip: "—",
    automationLevel: "PARTIAL",
    autoProvable: "частично",
    reportWording: "проверено частично; показать stats: комментарии, «?», кандидаты",
  },
  42: {
    sources: "AppTask title, description, comments",
    scope: "активные task-level карточки",
    candidates: "текст с маркерами: уточнить, обсудить, ждем ответ, ждём ответ, непонятно",
    violation: "маркер в активной карточке без закрывающего комментария",
    passed: "маркеров нет или закрыты",
    notChecked: "—",
    outcomeOK: "0 совпадений → показать маркеры и поля поиска",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "TEXT_MARKER",
    autoProvable: "частично",
    reportWording: "по фиксированным текстовым маркерам",
  },
  43: {
    sources: "AppTask status, assignees",
    scope: "карточки на этапе проверки / QA",
    candidates: "текущий статус ∈ review/QA",
    violation: "исполнитель (тестировщик) не назначен",
    passed: "назначен",
    notChecked: "—",
    outcomeOK: "0 задач на проверке",
    outcomePartial: "—",
    outcomeSkip: "—",
    automationLevel: "STRICT",
    autoProvable: "да",
  },
  44: {
    sources: "AppTask DB: BoardTaskUsers + Users.blocked",
    scope: "task-level с назначенным исполнителем",
    candidates: "назначения на исполнителей",
    violation: "исполнитель blocked=true в dbo.Users",
    passed: "исполнитель активен",
    notChecked: "список пользователей не загружен",
    outcomeOK: "нет blocked assignees",
    outcomePartial: "—",
    outcomeSkip: "список пользователей не загружен",
    automationLevel: "STRICT",
    autoProvable: "да",
    reportWording: "blocked из dbo.Users",
  },
  45: {
    sources: "AppTask title; status (завершённые); Scrum ПВ (косвенно)",
    scope: "завершённые task-level для актов",
    candidates: "завершённые задачи",
    violation: "название не готово к акту",
    passed: "название OK",
    notChecked: "фактическое время и ПВ — отдельные правила, здесь не проверяются",
    outcomeOK: "0 завершённых или все OK по названию",
    outcomePartial: "проверено частично: только название",
    outcomeSkip: "—",
    automationLevel: "PARTIAL",
    autoProvable: "частично",
    reportWording: "время и ПВ — отдельные правила",
  },
};

/** Детальные спеки из операционного реестра для обязательных полей. */
const MANDATORY_EVIDENCE_FROM_OPERATIONAL: Partial<Record<string, number>> = {
  description_present: 5,
  assignee_present: 18,
  open_questions_closed: 41,
  unresolved_question_keywords_in_card: 42,
  review_stage_requires_assignee: 43,
  blocked_assignee_not_allowed: 44,
};

/** Полная матрица доказательств для реестра отчёта. */
export const CONTRACT_RULE_EVIDENCE: readonly ContractRuleEvidenceSpec[] = [
  ...MANDATORY_CARD_FIELD_CHECK_REGISTRY.map((entry) => {
    const ruleId = entry.ruleIds[0]!;
    const opNum = MANDATORY_EVIDENCE_FROM_OPERATIONAL[ruleId];
    const spec = opNum ? EVIDENCE_BY_NUM[opNum] : MANDATORY_EVIDENCE_BY_RULE[ruleId];
    if (!spec) {
      throw new Error(`Missing mandatory evidence spec for ${ruleId}`);
    }
    return {
      num: entry.num,
      title: entry.title,
      ruleIds: entry.ruleIds,
      ...spec,
    };
  }),
  ...getOperationalCheckRegistry().map((entry) => {
    const original = CONTRACT_OPERATIONAL_CHECK_REGISTRY.find(
      (e) => e.ruleIds[0] === entry.ruleIds[0],
    );
    if (!original) {
      throw new Error(`Missing operational registry entry for ${entry.ruleIds[0]}`);
    }
    const spec = EVIDENCE_BY_NUM[original.num];
    if (!spec) {
      throw new Error(`Missing evidence spec for operational check #${original.num}`);
    }
    return {
      num: entry.num,
      title: entry.title,
      ruleIds: entry.ruleIds,
      ...spec,
    };
  }),
];

export function getEvidenceSpecByNum(num: number): ContractRuleEvidenceSpec | undefined {
  return CONTRACT_RULE_EVIDENCE.find((s) => s.num === num);
}

export function getEvidenceSpecByRuleId(ruleId: string): ContractRuleEvidenceSpec | undefined {
  const mandatory = CONTRACT_RULE_EVIDENCE.find(
    (s) => s.ruleIds.includes(ruleId) && s.num <= MANDATORY_CARD_FIELD_CHECK_REGISTRY.length,
  );
  if (mandatory) return mandatory;
  return CONTRACT_RULE_EVIDENCE.find((s) => s.ruleIds.includes(ruleId));
}

export function groupEvidenceByAutomationLevel(): Record<
  AutomationLevel,
  ContractRuleEvidenceSpec[]
> {
  const groups: Record<AutomationLevel, ContractRuleEvidenceSpec[]> = {
    STRICT: [],
    TEXT_MARKER: [],
    PARTIAL: [],
    SOURCE_UNAVAILABLE: [],
    MANUAL_REQUIRED: [],
  };
  for (const spec of CONTRACT_RULE_EVIDENCE) {
    groups[spec.automationLevel].push(spec);
  }
  return groups;
}
