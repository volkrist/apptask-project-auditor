import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import { ruleLabel } from "./rule-labels.js";

function formatTaskHeader(card: CardAudit): string {
  const id = card.task.id ? `№${card.task.id}` : "без номера";
  const title = card.task.title ?? "(без названия)";
  return `### ${id}: ${title}`;
}

function formatResults(results: RuleResult[]): string[] {
  const issues = results.filter((r) => r.status !== "PASS");
  if (issues.length === 0) {
    return ["_Все проверки пройдены._"];
  }
  return issues.map(
    (r) =>
      `- **${r.status}** \`${r.ruleId}\` (${ruleLabel(r.ruleId)}): ${r.reason}`,
  );
}

/** Полный markdown-отчёт по всем карточкам. */
export function buildDetailMarkdown(result: AuditResult): string {
  const { meta, topIssues, cards } = result;
  const lines: string[] = [
    `# Детальный отчёт аудита`,
    "",
    `| Поле | Значение |`,
    `|------|----------|`,
    `| Проект | ${meta.projectName} |`,
    `| Доска | ${meta.boardUrl} |`,
    `| Время | ${meta.auditedAt} |`,
    `| Карточек | ${meta.cardsChecked} |`,
    `| FAIL | ${meta.failCount} |`,
    `| WARN | ${meta.warnCount} |`,
    "",
    "## Сводка по правилам",
    "",
  ];

  if (topIssues.length === 0) {
    lines.push("_Нарушений нет._", "");
  } else {
    for (const issue of topIssues) {
      lines.push(`- ${issue.label} (\`${issue.ruleId}\`): **${issue.count}**`);
    }
    lines.push("");
  }

  lines.push("## Карточки", "");

  for (const card of cards) {
    lines.push(formatTaskHeader(card));
    if (card.task.url) lines.push(`- URL: ${card.task.url}`);
    if (card.task.status) lines.push(`- Статус: ${card.task.status}`);
    if (card.task.assignees.length) {
      lines.push(`- Исполнители: ${card.task.assignees.join(", ")}`);
    }
    lines.push("");
    lines.push(...formatResults(card.results));
    lines.push("");
  }

  return lines.join("\n");
}
