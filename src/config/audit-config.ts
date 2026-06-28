/**
 * Business thresholds for audit rules.
 * Rule implementations read from here — do not hardcode in adapters.
 */

export const defaultAuditConfig = {
  genericTitleBlacklist: [
    "правки",
    "доработки",
    "баги",
    "сайт",
    "проверить",
    "исправить",
    "сделать",
    "задача",
    "тест",
    "работа",
    "обновить",
    "посмотреть",
  ],
  requiredTaskTypes: [
    "баг",
    "доработка",
    "дизайн",
    "тестирование",
    "аналитика",
    "релиз",
    "поддержка",
    "найм",
  ],
  /** Категория доски → тип задачи (точное совпадение, lower case). */
  categoryTaskTypeMap: {
    найм: "найм",
  } as Record<string, string>,
  requiredTags: [] as string[],
  descriptionMinLength: 80,
  titleMinLength: 8,
  titleMinWords: 2,
  goalKeywords: [
    "цель",
    "цели",
    "основные цели",
    "результат",
    "ожидаемый результат",
    "ожидается",
    "ожидаем",
    "критерии",
    "критерий",
    "нужно чтобы",
    "пользователь должен",
    "должно работать",
    "должен включать",
    "должен содержать",
    "должен обеспечивать",
    "необходимо",
    "требуется",
    "готово когда",
    "итог",
  ],
  taskTypeSource: "tag_or_category" as const,
  reportMode: "summary_plus_details" as const,
  linkCheckTimeoutMs: 5000,
  linkCheckEnabled: true,
  duplicateSimilarityThreshold: 0.85,
  estimateLinkPatterns: [
    /смет/i,
    /договор/i,
    /заявк/i,
    /согласован/i,
    /invoice/i,
    /estimate/i,
    /contract/i,
    /budget/i,
    /google\.com\/spreadsheets/i,
  ],
  artifactLinkPatterns: [
    /figma\.com/i,
    /docs\.google\.com/i,
    /google\.com\/document/i,
    /notion\./i,
    /github\.com/i,
    /gitlab\./i,
    /bitbucket\./i,
    /jira\./i,
    /youtrack/i,
    /confluence/i,
    /drive\.google/i,
    /google\.com\/spreadsheets/i,
    /заявк/i,
    /макет/i,
    /mockup/i,
    /тз/i,
    /документац/i,
    /репозитор/i,
    /spec/i,
  ],
  estimateTextPatterns: [/бюджет/i, /смет/i, /стоимост/i, /часов/i, /estimate/i, /budget/i],
  stageByStatus: {
    "Новая задача": ["нов", "бэклог", "backlog", "ожид"],
    "В процессе": ["этап", "работ", "разработ", "реализац", "doing", "процесс"],
    "На проверке": ["провер", "qa", "review", "testing", "тест"],
    "Завершено": ["заверш", "готово", "done", "закрыт", "closed", "выполн"],
  } as Record<string, string[]>,
  emptyPlannedTimeValues: ["00:00", "0:00", "0"],
  /** Минимальный срок задачи (дни) при совпадении created/due — эвристика. */
  minRealisticDueSpanDays: 1,
  /** Признаки незакрытого вопроса — title, descriptionText, comments[]. */
  unresolvedQuestionKeywords: [
    "уточнить",
    "обсудить",
    "ждем ответ",
    "ждём ответ",
    "непонятно",
  ],
  /** status/stage: карточка на проверке. */
  reviewStageKeywords: [
    "проверка",
    "на проверке",
    "testing",
    "review",
    "qa",
  ],
  /** Имена тестировщиков из QA_TESTERS (пусто = не требовать QA по имени). */
  qaTesters: [] as string[],
} as const;

export type AuditConfig = {
  readonly genericTitleBlacklist: readonly string[];
  readonly requiredTaskTypes: readonly string[];
  readonly categoryTaskTypeMap: Readonly<Record<string, string>>;
  requiredTags: string[];
  readonly descriptionMinLength: number;
  readonly titleMinLength: number;
  readonly titleMinWords: number;
  readonly goalKeywords: readonly string[];
  readonly taskTypeSource: "tag_or_category";
  readonly reportMode: "summary_plus_details";
  readonly linkCheckTimeoutMs: number;
  linkCheckEnabled: boolean;
  readonly duplicateSimilarityThreshold: number;
  readonly estimateLinkPatterns: readonly RegExp[];
  readonly artifactLinkPatterns: readonly RegExp[];
  readonly estimateTextPatterns: readonly RegExp[];
  readonly stageByStatus: Record<string, string[]>;
  readonly emptyPlannedTimeValues: readonly string[];
  readonly minRealisticDueSpanDays: number;
  readonly unresolvedQuestionKeywords: readonly string[];
  readonly reviewStageKeywords: readonly string[];
  qaTesters: string[];
};

function parseCommaListFromEnv(envKey: string): string[] {
  const raw = process.env[envKey]?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRequiredTagsFromEnv(): string[] {
  return parseCommaListFromEnv("REQUIRED_TAGS");
}

function parseQaTestersFromEnv(): string[] {
  return parseCommaListFromEnv("QA_TESTERS");
}

/** Конфиг с учётом env (REQUIRED_TAGS, LINK_CHECK_ENABLED). */
export function loadAuditConfig(overrides: Partial<AuditConfig> = {}): AuditConfig {
  const linkEnv = process.env.LINK_CHECK_ENABLED?.trim().toLowerCase();
  const linkCheckEnabled =
    linkEnv === "false" || linkEnv === "0" ? false : defaultAuditConfig.linkCheckEnabled;

  return {
    ...defaultAuditConfig,
    requiredTags: parseRequiredTagsFromEnv(),
    qaTesters: parseQaTestersFromEnv(),
    linkCheckEnabled,
    ...overrides,
  };
}

/** @deprecated Используйте loadAuditConfig() — оставлено для тестов с linkCheckEnabled: false */
export const auditConfig: AuditConfig = loadAuditConfig();
