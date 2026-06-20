import { EmbedBuilder } from "discord.js";
import type { RunAuditResult } from "../app/run-audit.js";
import type { RunCommentsCheckResult } from "../app/run-comments-check.js";
import {
  buildRegistryTableRows,
  summarizeRegistryOutcomes,
} from "../reports/check-registry-stats.js";

const RULE_LABELS: Record<string, string> = {
  deadline_present: "Нет дедлайна",
  artifact_links_present: "Нет ссылок на артефакты",
  estimate_present: "Нет оценки времени/бюджета",
  estimate_link_present: "Нет ссылки на смету/договор",
  description_has_goal: "Нет цели в описании",
  assignee_present: "Нет исполнителя",
  description_present: "Нет или короткое описание",
  priority_present: "Нет приоритета",
  stage_matches_column: "Этап не соответствует статусу",
  unresolved_question_keywords_in_card: "Есть признаки незакрытого вопроса",
  blocked_assignee_not_allowed: "Назначен неактивный/заблокированный сотрудник",
};

const ISSUE_RECOMMENDATIONS: Record<string, string> = {
  deadline_present: "Заполнить дедлайны",
  artifact_links_present:
    "Добавить ссылки на ТЗ, макеты, документы или репозитории",
  estimate_present: "Указать оценку времени или бюджета",
  assignee_present: "Назначить ответственных исполнителей",
  description_present: "Заполнить описание задачи",
  description_has_goal: "Добавить цель или ожидаемый результат",
};

export function humanizeRuleLabel(ruleId: string, fallbackLabel: string): string {
  return RULE_LABELS[ruleId] ?? fallbackLabel;
}

export function buildRecommendations(
  topIssues: Array<{ ruleId: string }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issue of topIssues) {
    const rec = ISSUE_RECOMMENDATIONS[issue.ruleId];
    if (!rec || seen.has(rec)) continue;
    seen.add(rec);
    out.push(rec);
    if (out.length >= 4) break;
  }
  return out;
}

export function recommendationForRule(ruleId: string): string | null {
  return ISSUE_RECOMMENDATIONS[ruleId] ?? null;
}

export function getAuditStatusText(failCount: number, warnCount: number): string {
  if (failCount > 0) return "Требует доработки";
  if (warnCount > 0) return "Есть предупреждения";
  return "Проблем не найдено";
}

export function getCommentsStatusText(markersFound: number): string {
  return markersFound > 0
    ? "Есть вопросы для проверки"
    : "Маркеры не найдены";
}

/** Короткое уведомление в Discord; полный отчёт — во вложениях audit-report.html (+ audit-report.md). */
export function buildAuditReportEmbed(
  out: RunAuditResult,
): EmbedBuilder {
  const { meta } = out.result;
  const status = getAuditStatusText(meta.failCount, meta.warnCount);
  const excluded = meta.excludedFlowTasks ?? 0;
  const profile = meta.auditProfile ?? "contract_turboweave_v1";
  const registry = summarizeRegistryOutcomes(
    buildRegistryTableRows(out.result),
    out.result,
  );
  const attachMd = process.env.AUDIT_DISCORD_ATTACH_MD?.trim().toLowerCase();
  const includeMd =
    attachMd !== "0" && attachMd !== "false" && attachMd !== "no";

  const overview = [
    `Проверено: **${meta.cardsChecked}** карточек`,
    excluded > 0 ? `Исключено потоковых: **${excluded}**` : null,
    `FAIL: **${meta.failCount}** | WARN: **${meta.warnCount}**`,
    `CHECKED: **${registry.checked}** | SKIP: **${registry.skip}**`,
    `Статус: **${status}**`,
    `Профиль: \`${profile}\``,
  ]
    .filter(Boolean)
    .join("\n");

  return new EmbedBuilder()
    .setTitle(`${meta.projectName} audit completed`)
    .setDescription(
      includeMd
        ? "Полный отчёт: **audit-report.html** и **audit-report.md** во вложениях."
        : "Полный отчёт: **audit-report.html** во вложении.",
    )
    .setColor(meta.failCount > 0 ? 0xed4245 : meta.warnCount > 0 ? 0xfee75c : 0x57f287)
    .addFields({ name: "Сводка", value: overview, inline: false });
}

export function buildCommentsReportEmbed(
  out: RunCommentsCheckResult,
): EmbedBuilder {
  const status = getCommentsStatusText(out.markerHits.length);
  const cardsLine =
    out.totalTasksOnBoard > out.checkedTasks
      ? `${out.checkedTasks} из ${out.totalTasksOnBoard}`
      : String(out.checkedTasks);

  return new EmbedBuilder()
    .setTitle("✅ Проверка комментариев завершена")
    .setColor(out.markerHits.length > 0 ? 0xfee75c : 0x57f287)
    .addFields(
      { name: "Доска", value: out.boardUrl },
      { name: "Проверено карточек", value: cardsLine, inline: true },
      {
        name: "Карточек с комментариями",
        value: String(out.tasksWithComments),
        inline: true,
      },
      { name: "Всего комментариев", value: String(out.totalComments), inline: true },
      {
        name: "Маркеров незакрытых вопросов",
        value: String(out.markerHits.length),
        inline: true,
      },
      { name: "Общий статус", value: status, inline: false },
    );
}
