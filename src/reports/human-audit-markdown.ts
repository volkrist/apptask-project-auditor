import type { AuditResult, CardAudit } from "../rules/rule-types.js";
import { ruleLabel } from "./rule-labels.js";
import { buildCommentIssuesMarkdown } from "./comment-issues.js";
import {
  buildStatusDeadlineMarkdown,
  buildTestingQueueMarkdown,
} from "./structured-findings.js";
import { buildScrumEstimateMarkdown } from "./scrum-findings.js";
import { buildTrackingHoursMarkdown } from "./tracking-findings.js";
import { buildManagementSummary } from "./management-summary.js";

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
  unresolved_question_keywords_in_card: "Есть признак незакрытого вопроса",
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

function appendTechnicalAppendix(lines: string[], result: AuditResult): void {
  if (!result.meta.issueCounts) return;
  const c = result.meta.issueCounts;
  lines.push(
    "",
    "## Техническое приложение: сводка счётчиков",
    "",
    `- Сроки/дедлайны: ${c.deadlineIssues}`,
    `- В работе без обновлений: ${c.staleInProgressIssues}`,
    `- На проверке без движения: ${c.staleReviewIssues}`,
    `- Очередь тестирования (доски): ${c.testingQueueIssues}`,
    `- Critical/high без движения: ${c.criticalNoMovementIssues}`,
    `- Проблемы по комментариям: ${c.commentIssues}`,
    `- Scrum: не в смете ${c.scrumEstimateMissing ?? 0} | название ${c.scrumNameMismatch ?? 0} | ПВ ${c.pvMissing ?? 0} | декомп. ${c.decompositionMissing ?? 0}`,
    `- Tracking: done без часов ${c.doneWithoutTracking ?? 0} | in progress stale ${c.inProgressWithoutRecentTracking ?? 0} | факт>ПВ ${c.actualHoursExceededEstimate ?? 0} | без коммент. ${c.estimateExceededWithoutComment ?? 0} | вне статуса ${c.trackingOnNonWorkStatus ?? 0}`,
    "",
    "_Понятная сводка для руководителя — в human-summary.md._",
  );
}

export function buildHumanAuditMarkdown(
  result: AuditResult,
  extras: { ignoredCount?: number; ignoredUrls?: string[] } = {},
): string {
  const status = getAuditStatusText(result.meta.failCount, result.meta.warnCount);
  const mgmt = buildManagementSummary(result);

  const lines: string[] = [
    "# Отчёт аудита AppTask",
    "",
    "## Краткий вывод",
    "",
    mgmt.briefConclusion,
    "",
    "## 1. Общая сводка",
    `- Проект: ${result.meta.projectName}`,
    `- Доска: ${result.meta.boardUrl}`,
  ];

  if (result.meta.auditScope) {
    lines.push(`- Режим аудита: ${result.meta.auditScope}`);
  }
  if (result.meta.maxCardsScope) {
    lines.push(
      `- Лимит карточек: ${result.meta.maxCardsScope === "total" ? "суммарно по всем доскам (round-robin)" : result.meta.maxCardsScope}`,
    );
  }
  if (result.meta.boardsChecked != null && result.meta.boardsChecked > 0) {
    lines.push(`- Проверено досок: ${result.meta.boardsChecked}`);
  }

  lines.push(
    `- Дата проверки: ${result.meta.auditedAt}`,
    `- Проверено карточек: ${result.meta.cardsChecked}`,
    `- Критичных проблем: ${result.meta.failCount}`,
    `- Предупреждений: ${result.meta.warnCount}`,
    `- Общий статус: ${status}`,
  );

  if (result.meta.boardSummaries && result.meta.boardSummaries.length > 0) {
    lines.push("", "## 1.1. Сводка по доскам");
    for (const board of result.meta.boardSummaries) {
      lines.push(
        `- **Доска ${board.boardId}** (${board.boardUrl}): проверено **${board.tasksChecked}** из ${board.tasksAvailable} | FAIL: ${board.failCount} | WARN: ${board.warnCount}`,
      );
    }
  }

  lines.push(
    "",
    "## 2. Детализация по карточкам",
  );
  const problematicCards = result.cards.filter((c) =>
    c.results.some((r) => r.status !== "PASS"),
  );

  if (problematicCards.length === 0) {
    lines.push("- Все карточки без нарушений");
    appendTechnicalAppendix(lines, result);
    return `${lines.join("\n")}\n`;
  }

  const groupByBoard =
    result.meta.auditScope === "multi" &&
    new Set(problematicCards.map((c) => c.task.boardId ?? "?")).size > 1;

  if (groupByBoard) {
    const byBoard = new Map<string, CardAudit[]>();
    for (const card of problematicCards) {
      const bid = card.task.boardId ?? "?";
      const list = byBoard.get(bid) ?? [];
      list.push(card);
      byBoard.set(bid, list);
    }
    for (const boardId of [...byBoard.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    )) {
      lines.push("", `### Доска ${boardId}`);
      for (const card of byBoard.get(boardId)!) {
        appendCardSection(lines, card);
      }
    }
    appendTechnicalAppendix(lines, result);
    return `${lines.join("\n")}\n`;
  }

  for (const card of problematicCards) {
    appendCardSection(lines, card);
  }

  appendTechnicalAppendix(lines, result);

  return `${lines.join("\n")}\n`;
}

function appendCardSection(lines: string[], card: CardAudit): void {
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
