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
  goalKeywords: ["цель", "ожидаем", "результат", "итог"],
  taskTypeSource: "tag_or_category" as const,
  reportMode: "summary_plus_details" as const,
  linkCheckTimeoutMs: 5000,
  duplicateSimilarityThreshold: 0.85,
} as const;

export type AuditConfig = typeof auditConfig;
