import type { AuditResult } from "../rules/rule-types.js";

/** Короткий markdown-обзор для папки аудита. */
export function buildSummaryMarkdown(result: AuditResult): string {
  const { meta, topIssues } = result;
  const lines: string[] = [
    `# Аудит: ${meta.projectName}`,
    "",
    `- **Доска:** ${meta.boardUrl}`,
  ];

  if (meta.auditScope) {
    lines.push(`- **Режим:** ${meta.auditScope}`);
  }
  if (meta.boardsChecked != null) {
    lines.push(`- **Досок проверено:** ${meta.boardsChecked}`);
  }

  lines.push(
    `- **Проверено:** ${meta.auditedAt}`,
    `- **Карточек:** ${meta.cardsChecked}`,
    `- **FAIL:** ${meta.failCount}`,
    `- **WARN:** ${meta.warnCount}`,
  );

  if (meta.boardSummaries && meta.boardSummaries.length > 0) {
    lines.push("", "## По доскам", "");
    for (const b of meta.boardSummaries) {
      lines.push(
        `- board **${b.boardId}**: ${b.tasksChecked}/${b.tasksAvailable} карточек, FAIL ${b.failCount}, WARN ${b.warnCount}`,
      );
    }
  }

  lines.push(
    "",
    "## Топ проблем",
    "",
  );

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
