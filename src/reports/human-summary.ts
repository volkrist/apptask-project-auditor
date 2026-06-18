import type { AuditResult } from "../rules/rule-types.js";
import { buildManagementSummary } from "./management-summary.js";

export function buildHumanSummaryMarkdown(result: AuditResult): string {
  const { meta } = result;
  const mgmt = buildManagementSummary(result);
  const lines: string[] = [
    `# Аудит ${meta.projectName} — краткий отчёт`,
    "",
    "## 1. Итог",
    "",
    mgmt.introNarrative,
    "",
    "## 2. Главные риски",
    "",
  ];

  if (mgmt.risks.length === 0) {
    lines.push("Существенных рисков не выявлено.");
  } else {
    mgmt.risks.forEach((risk, idx) => {
      lines.push(
        `### ${idx + 1}. ${risk.title}`,
        "",
        `- Количество: ${risk.count}`,
        `- Почему это важно: ${risk.whyImportant}`,
        `- Что сделать: ${risk.action}`,
        "",
      );
    });
  }

  lines.push("## 3. Топ задач для разбора", "");

  if (mgmt.topTasks.length === 0) {
    lines.push("Задач, требующих срочного разбора, не найдено.");
  } else {
    for (const task of mgmt.topTasks) {
      lines.push(
        `### №${task.id} — ${task.title}`,
        "",
        `Ссылка: ${task.url}`,
        `Проблема: ${task.problem}`,
        `Кто: ${task.assignees}`,
        `Что сделать: ${task.action}`,
        "",
      );
    }
  }

  lines.push("## 4. Scrum / смета", "");
  for (const bullet of mgmt.scrumBullets) {
    lines.push(`- ${bullet}`);
  }

  lines.push("", "## 5. Фактическое время", "");
  for (const bullet of mgmt.trackingBullets) {
    lines.push(`- ${bullet}`);
  }

  lines.push(
    "",
    "## 6. Полная детализация",
    "",
    "Полный технический отчёт со всеми правилами, ruleId и детализацией по каждой карточке находится в audit-report.md.",
    "",
  );

  return `${lines.join("\n")}\n`;
}
