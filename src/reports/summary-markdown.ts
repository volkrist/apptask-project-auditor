import type { AuditResult } from "../rules/rule-types.js";

/** Короткий markdown-обзор для папки аудита. */
export function buildSummaryMarkdown(result: AuditResult): string {
  const { meta, topIssues } = result;
  const lines: string[] = [
    `# Аудит: ${meta.projectName}`,
    "",
    `- **Доска:** ${meta.boardUrl}`,
    `- **Проверено:** ${meta.auditedAt}`,
    `- **Карточек:** ${meta.cardsChecked}`,
    `- **FAIL:** ${meta.failCount}`,
    `- **WARN:** ${meta.warnCount}`,
    "",
    "## Топ проблем",
    "",
  ];

  if (topIssues.length === 0) {
    lines.push("_Критичных и предупреждающих срабатываний нет._");
  } else {
    for (const issue of topIssues) {
      lines.push(`- **${issue.label}** (\`${issue.ruleId}\`) — ${issue.count}`);
    }
  }

  lines.push("", "_Подробности — в `audit.json` и `audit.md`._");
  return lines.join("\n");
}
