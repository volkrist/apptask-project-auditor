/**
 * Business thresholds for audit rules.
 * Rule implementations read from here — do not hardcode in adapters.
 */
export const auditConfig = {
  genericTitleBlacklist: [
    "правки",
    "доработки",
    "баги",
    "сайт",
    "проверить",
  ],
  requiredTaskTypes: [
    "баг",
    "доработка",
    "дизайн",
    "тестирование",
    "аналитика",
    "релиз",
    "поддержка",
  ],
  requiredTags: [] as string[],
  descriptionMinLength: 50,
  titleMinLength: 8,
  goalKeywords: ["цель", "ожидаем", "результат", "итог"],
  taskTypeSource: "tag_or_category" as const,
  reportMode: "summary_plus_details" as const,
  linkCheckTimeoutMs: 5000,
  linkCheckEnabled: false,
  duplicateSimilarityThreshold: 0.85,
  estimateLinkPatterns: [/смет/i, /договор/i, /estimate/i, /budget/i],
  artifactLinkPatterns: [
    /figma\.com/i,
    /github\.com/i,
    /gitlab\./i,
    /макет/i,
    /mockup/i,
    /spec/i,
    /тз/i,
  ],
  /** Ожидаемые подстроки этапа для колонки статуса (эвристика). */
  stageByStatus: {
    "Новая задача": ["этап", "нов"],
    "В процессе": ["этап", "процесс"],
    "На проверке": ["этап", "провер"],
    "Завершено": ["этап", "заверш"],
  } as Record<string, string[]>,
  emptyPlannedTimeValues: ["00:00", "0:00", "0"],
} as const;

export type AuditConfig = typeof auditConfig;
