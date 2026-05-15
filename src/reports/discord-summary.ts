import type { AuditResult } from "../rules/rule-types.js";

export function buildDiscordSummary(result: AuditResult): string {
  const { meta } = result;
  return [
    `Проект: ${meta.projectName}`,
    `Проверено карточек: ${meta.cardsChecked}`,
    `FAIL: ${meta.failCount}`,
    `WARN: ${meta.warnCount}`,
    "",
    "Топ проблем:",
    "_not implemented_",
    "",
    "Файл с деталями приложен.",
  ].join("\n");
}
