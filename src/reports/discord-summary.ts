import type { AuditResult } from "../rules/rule-types.js";

/** Discord content limit (с запасом под форматирование). */
export const DISCORD_SUMMARY_MAX_LENGTH = 1800;

/** Короткий текст для одного сообщения в Discord. */
export function buildDiscordSummary(result: AuditResult): string {
  const { meta, topIssues } = result;
  const lines: string[] = [
    `📋 **Аудит AppTask — ${meta.projectName}**`,
    `Карточек: **${meta.cardsChecked}** | FAIL: **${meta.failCount}** | WARN: **${meta.warnCount}**`,
    `Доска: ${meta.boardUrl}`,
    "",
    "**Топ проблем:**",
  ];

  if (topIssues.length === 0) {
    lines.push("— нарушений не найдено");
  } else {
    for (const issue of topIssues) {
      lines.push(`• ${issue.label} — ${issue.count}`);
    }
  }

  lines.push("", "📎 Детальный отчёт приложен (`audit.json`).");
  return truncateDiscordSummary(lines.join("\n"));
}

export function truncateDiscordSummary(text: string, maxLen = DISCORD_SUMMARY_MAX_LENGTH): string {
  if (text.length <= maxLen) return text;
  const suffix = "\n\n… (сообщение сокращено)";
  return `${text.slice(0, maxLen - suffix.length).trimEnd()}${suffix}`;
}
