import type { ContractRuleEvidenceSpec } from "../config/contract-rule-evidence.js";
import {
  CONTRACT_RULE_EVIDENCE,
  REVIEW_STATUS_ALIASES,
  groupEvidenceByAutomationLevel,
} from "../config/contract-rule-evidence.js";
import type { AutomationLevel } from "../rules/evidence-types.js";

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function automationLevelRu(level: AutomationLevel): string {
  const map: Record<AutomationLevel, string> = {
    STRICT: "STRICT — полностью доказуемо",
    TEXT_MARKER: "TEXT_MARKER — по фиксированным маркерам",
    PARTIAL: "PARTIAL — автоматизация неполная",
    SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE — источник недоступен",
    MANUAL_REQUIRED: "MANUAL_REQUIRED — нужна ручная проверка",
  };
  return map[level];
}

export function formatEvidenceMatrixTable(): string[] {
  const lines = [
    "| № | Проверка | Источники | Scope | Candidates | Violation | Passed | Not checked | Итог OK | Итог PARTIAL | Итог SKIP | automationLevel |",
    "| - | -------- | --------- | ----- | ---------- | --------- | ------ | ----------- | ------- | ------------ | --------- | --------------- |",
  ];

  for (const spec of CONTRACT_RULE_EVIDENCE) {
    lines.push(
      `| ${spec.num} | ${escapeCell(spec.title)} | ${escapeCell(spec.sources)} | ${escapeCell(spec.scope)} | ${escapeCell(spec.candidates)} | ${escapeCell(spec.violation)} | ${escapeCell(spec.passed)} | ${escapeCell(spec.notChecked)} | ${escapeCell(spec.outcomeOK)} | ${escapeCell(spec.outcomePartial)} | ${escapeCell(spec.outcomeSkip)} | ${spec.automationLevel} |`,
    );
  }

  return lines;
}

export function formatAutomationLevelSummary(): string[] {
  const groups = groupEvidenceByAutomationLevel();
  const lines: string[] = ["## Распределение по automationLevel", ""];

  for (const level of [
    "STRICT",
    "TEXT_MARKER",
    "PARTIAL",
    "SOURCE_UNAVAILABLE",
    "MANUAL_REQUIRED",
  ] as const) {
    const items = groups[level];
    lines.push(`### ${automationLevelRu(level)} (${items.length})`, "");
    for (const spec of items) {
      lines.push(`- **№${spec.num}** — ${spec.title}`);
    }
    lines.push("");
  }

  return lines;
}

export function formatRuleDetailSection(spec: ContractRuleEvidenceSpec): string[] {
  const lines = [
    `### №${spec.num}. ${spec.title}`,
    "",
    `- **ruleIds:** ${spec.ruleIds.join(", ")}`,
    `- **automationLevel:** ${spec.automationLevel} (${spec.autoProvable})`,
    `- **Источники:** ${spec.sources}`,
    `- **Scope:** ${spec.scope}`,
    `- **Candidates:** ${spec.candidates}`,
    `- **Violation:** ${spec.violation}`,
    `- **Passed:** ${spec.passed}`,
    `- **Not checked:** ${spec.notChecked}`,
    `- **Итог OK:** ${spec.outcomeOK}`,
    `- **Итог PARTIAL:** ${spec.outcomePartial}`,
    `- **Итог SKIP:** ${spec.outcomeSkip}`,
  ];
  if (spec.reportWording) {
    lines.push(`- **Формулировка в отчёте:** ${spec.reportWording}`);
  }
  lines.push("");
  return lines;
}

export function formatReviewStatusAliasesSection(): string[] {
  return [
    "## Review / QA status aliases",
    "",
    "Статусы, распознаваемые правилами №16, №17, №31, №43:",
    "",
    ...REVIEW_STATUS_ALIASES.map((a) => `- ${a}`),
    "",
    "Регулярное выражение: `TESTING_STATUS_RE` в `src/rules/status/status-helpers.ts`.",
    "",
  ];
}

export function formatFullEvidenceMatrixMarkdown(): string {
  const parts = [
    "# Audit Rule Evidence Matrix",
    "",
    "Единый источник правды для доказательности 45 контрактных проверок.",
    "Машиночитаемая версия: `src/config/contract-rule-evidence.ts`.",
    "Отчёты (HTML / Markdown) должны только **отображать** `EvidenceResult`, не вычислять candidates/violations самостоятельно.",
    "",
    "## Сводная таблица",
    "",
    ...formatEvidenceMatrixTable(),
    "",
    ...formatAutomationLevelSummary(),
    ...formatReviewStatusAliasesSection(),
    "## Детализация по проверкам",
    "",
  ];

  for (const spec of CONTRACT_RULE_EVIDENCE) {
    parts.push(...formatRuleDetailSection(spec));
  }

  parts.push(
    "## EvidenceResult",
    "",
    "Каждое правило возвращает структуру:",
    "",
    "```typescript",
    "type EvidenceResult = {",
    "  ruleId: string;",
    "  contractNum: number;",
    "  scopeCount: number;",
    "  candidateCount: number;",
    "  passedCount: number;",
    "  violationCount: number;",
    "  notCheckedCount: number;",
    "  status: 'OK' | 'WARN' | 'FAIL' | 'PARTIAL' | 'SKIP';",
    "  automationLevel: AutomationLevel;",
    "  sources: string[];",
    "  candidateEvidence: EvidenceItem[];",
    "  violationEvidence: EvidenceItem[];",
    "  notCheckedEvidence: EvidenceItem[];",
    "  debug?: Record<string, string | number | boolean>;",
    "};",
    "```",
    "",
    "Сборка: `src/reports/build-evidence-result.ts`.",
    "",
  );

  return parts.join("\n");
}
