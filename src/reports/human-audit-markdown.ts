import type { AuditResult, CardAudit } from "../rules/rule-types.js";
import { ruleLabel } from "./rule-labels.js";

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
  artifact_links_present: "Добавить ссылки на ТЗ, макеты, документы",
  estimate_present: "Указать оценку времени или бюджета",
  assignee_present: "Назначить ответственных",
  description_present: "Заполнить описание задачи",
  description_has_goal: "Добавить цель и ожидаемый результат",
};

function humanizeRuleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleLabel(ruleId);
}

function getAuditStatusText(failCount: number, warnCount: number): string {
  if (failCount > 0) return "Требует доработки";
  if (warnCount > 0) return "Есть предупреждения";
  return "Проблем не найдено";
}

function issueRecommendations(topIssues: AuditResult["topIssues"]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const issue of topIssues) {
    const rec = ISSUE_RECOMMENDATIONS[issue.ruleId];
    if (!rec || seen.has(rec)) continue;
    seen.add(rec);
    lines.push(`- ${rec}`);
    if (lines.length >= 4) break;
  }
  return lines;
}

function cardStatus(card: CardAudit): string {
  const fail = card.results.filter((r) => r.status === "FAIL").length;
  const warn = card.results.filter((r) => r.status === "WARN").length;
  return getAuditStatusText(fail, warn);
}

function cardIssueLines(card: CardAudit): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const result of card.results) {
    if (result.status === "PASS") continue;
    const label = humanizeRuleLabel(result.ruleId);
    if (seen.has(label)) continue;
    seen.add(label);
    lines.push(`- ${label}`);
  }
  return lines;
}

function cardFixLines(card: CardAudit): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const result of card.results) {
    if (result.status === "PASS") continue;
    const rec = ISSUE_RECOMMENDATIONS[result.ruleId];
    if (!rec || seen.has(rec)) continue;
    seen.add(rec);
    lines.push(`- ${rec}`);
  }
  return lines;
}

export function buildHumanAuditMarkdown(
  result: AuditResult,
  extras: { ignoredCount?: number; ignoredUrls?: string[] } = {},
): string {
  const status = getAuditStatusText(result.meta.failCount, result.meta.warnCount);
  const topIssues = result.topIssues.slice(0, 5);
  const recommendations = issueRecommendations(result.topIssues);

  const lines: string[] = [
    "# Отчёт аудита AppTask",
    "",
    "## 1. Общая сводка",
    `- Проект: ${result.meta.projectName}`,
    `- Доска: ${result.meta.boardUrl}`,
    `- Дата проверки: ${result.meta.auditedAt}`,
    `- Проверено карточек: ${result.meta.cardsChecked}`,
    `- Критичных проблем: ${result.meta.failCount}`,
    `- Предупреждений: ${result.meta.warnCount}`,
    `- Общий статус: ${status}`,
    "",
    "## 2. Главные проблемы",
  ];

  if (topIssues.length === 0) {
    lines.push("- Проблем не найдено");
  } else {
    for (const issue of topIssues) {
      lines.push(`- ${humanizeRuleLabel(issue.ruleId)} — ${issue.count} карточек`);
    }
  }

  lines.push("", "## 3. Что исправить в первую очередь");
  if (recommendations.length === 0) {
    lines.push("- Нет срочных действий");
  } else {
    lines.push(...recommendations);
  }

  lines.push("", "## Исключённые карточки");
  lines.push(`- Исключено карточек: ${extras.ignoredCount ?? 0}`);
  const ignoredUrls = extras.ignoredUrls ?? [];
  if (ignoredUrls.length > 0 && ignoredUrls.length <= 10) {
    for (const url of ignoredUrls) lines.push(`- ${url}`);
  }

  lines.push("", "## 4. Детализация по карточкам");
  const problematicCards = result.cards.filter((c) =>
    c.results.some((r) => r.status !== "PASS"),
  );

  if (problematicCards.length === 0) {
    lines.push("- Все карточки без нарушений");
    return `${lines.join("\n")}\n`;
  }

  for (const card of problematicCards) {
    const id = card.task.id ? `№${card.task.id}` : "Без номера";
    const title = card.task.title ?? "(без названия)";
    lines.push("", `### ${id} — ${title}`);
    lines.push(`Ссылка: ${card.task.url ?? "—"}`);
    lines.push(`Статус: ${cardStatus(card)}`);
    lines.push("", "Проблемы:");
    lines.push(...cardIssueLines(card));
    lines.push("", "Что исправить:");
    const fixes = cardFixLines(card);
    lines.push(...(fixes.length > 0 ? fixes : ["- Проверить карточку вручную"]));
  }

  return `${lines.join("\n")}\n`;
}
