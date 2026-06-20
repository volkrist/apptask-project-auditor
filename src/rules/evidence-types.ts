/** Уровень автоматизации / доказуемости проверки. */
export type AutomationLevel =
  | "STRICT"
  | "TEXT_MARKER"
  | "PARTIAL"
  | "SOURCE_UNAVAILABLE"
  | "MANUAL_REQUIRED";

export type EvidenceStatus = "OK" | "WARN" | "FAIL" | "PARTIAL" | "SKIP";

/** Один объект в списке нарушений / не проверено / кандидатов. */
export type EvidenceItem = {
  objectLabel: string;
  reason: string;
  source: string;
  link?: string | null;
  taskId?: string | null;
};

/** Структурированный результат проверки для отчётов (HTML / Markdown только отображают). */
export type EvidenceResult = {
  ruleId: string;
  contractNum: number;
  scopeCount: number;
  candidateCount: number;
  passedCount: number;
  violationCount: number;
  notCheckedCount: number;
  status: EvidenceStatus;
  automationLevel: AutomationLevel;
  sources: string[];
  candidateEvidence: EvidenceItem[];
  violationEvidence: EvidenceItem[];
  notCheckedEvidence: EvidenceItem[];
  /** Доп. метрики для debug-секций (статусы, комментарии, маркеры). */
  debug?: Record<string, string | number | boolean>;
  /** Краткая подпись для таблицы реестра. */
  summaryLabel?: string;
};
