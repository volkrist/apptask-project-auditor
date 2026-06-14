import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import type { BoardAuditMetrics } from "../scrum/scrum-estimate-config.js";
import {
  COMMENT_STATUS_RULE_IDS,
  STALE_STATUS_RULE_IDS,
  TESTING_QUEUE_RULE_IDS,
} from "../rules/soft/status-comment-rules.js";
import {
  businessHoursSince,
  computeLastActivityAt,
  deadlineUrgency,
  formatHoursLabel,
  isHighPriorityOrCriticalBug,
} from "../rules/status/status-helpers.js";
import {
  findReviewStartedAt,
  findReworkTransitions,
} from "../rules/history/history-parser.js";
import { makeStateNameResolver } from "../collectors/state-map.js";
import { ruleLabel } from "./rule-labels.js";
import { computeScrumIssueCounts } from "./scrum-findings.js";

export type IssueCounts = {
  deadlineIssues: number;
  staleInProgressIssues: number;
  staleReviewIssues: number;
  testingQueueIssues: number;
  criticalNoMovementIssues: number;
  commentIssues: number;
  scrumEstimateMissing: number;
  scrumNameMismatch: number;
  pvMissing: number;
  decompositionMissing: number;
};

const DEADLINE_RULE_IDS = new Set(["deadline_less_than_one_day"]);

function cardHasRule(
  card: CardAudit,
  ruleIds: Set<string>,
  statuses: Array<RuleResult["status"]> = ["FAIL", "WARN"],
): boolean {
  return card.results.some(
    (r) => ruleIds.has(r.ruleId) && statuses.includes(r.status),
  );
}

function countCards(cards: CardAudit[], ruleIds: Set<string>): number {
  return cards.filter((c) => cardHasRule(c, ruleIds)).length;
}

export function computeIssueCounts(
  cards: CardAudit[],
  boardMetrics?: BoardAuditMetrics,
): IssueCounts {
  const testingBoards = new Set<string>();
  for (const card of cards) {
    if (!cardHasRule(card, TESTING_QUEUE_RULE_IDS)) continue;
    testingBoards.add(card.task.boardId ?? "?");
  }

  const commentRuleIds = COMMENT_STATUS_RULE_IDS;
  const scrumCounts = computeScrumIssueCounts(cards);
  return {
    deadlineIssues: countCards(cards, DEADLINE_RULE_IDS),
    staleInProgressIssues: countCards(
      cards,
      new Set(["in_progress_stale"]),
    ),
    staleReviewIssues: countCards(cards, new Set(["review_stale"])),
    testingQueueIssues:
      testingBoards.size ||
      (boardMetrics
        ? Object.values(boardMetrics.byBoard).filter(
            (b) => b.testingQueueCount > b.testingQueueMax,
          ).length
        : 0),
    criticalNoMovementIssues: countCards(
      cards,
      new Set(["high_priority_stale"]),
    ),
    commentIssues: countCards(cards, commentRuleIds),
    ...scrumCounts,
  };
}

function collectRuleRows(
  result: AuditResult,
  ruleIds: Set<string>,
): Array<{ card: CardAudit; rule: RuleResult }> {
  const rows: Array<{ card: CardAudit; rule: RuleResult }> = [];
  for (const card of result.cards) {
    for (const rule of card.results) {
      if (rule.status === "PASS") continue;
      if (!ruleIds.has(rule.ruleId)) continue;
      rows.push({ card, rule });
    }
  }
  return rows;
}

function taskLine(card: CardAudit): string {
  const t = card.task;
  const id = t.id ?? "?";
  return `- **Доска ${t.boardId ?? "?"}** | [№${id}](${t.url ?? "—"}) — ${t.title ?? "(без названия)"}`;
}

export function buildStatusDeadlineMarkdown(result: AuditResult): string[] {
  const lines: string[] = ["", "## Сроки и статусы", ""];
  const deadlineRows = collectRuleRows(result, DEADLINE_RULE_IDS);
  const inProgressRows = collectRuleRows(
    result,
    new Set(["in_progress_stale"]),
  );
  const reviewRows = collectRuleRows(result, new Set(["review_stale"]));
  const criticalRows = collectRuleRows(
    result,
    new Set(["high_priority_stale"]),
  );

  const any =
    deadlineRows.length +
      inProgressRows.length +
      reviewRows.length +
      criticalRows.length >
    0;

  if (!any) {
    lines.push("_Нарушений по срокам и статусам не найдено._");
    return lines;
  }

  if (deadlineRows.length > 0) {
    lines.push("### Дедлайн (< 1 дня / просрочено)", "");
    for (const { card, rule } of deadlineRows.slice(0, 20)) {
      const t = card.task;
      const urgency = deadlineUrgency(t);
      lines.push(
        taskLine(card),
        `  - статус: ${t.status ?? "—"} | дедлайн: ${t.dueDate ?? "—"} | ${urgency.label}`,
        `  - ${rule.status}: ${rule.reason}`,
        `  - исправить: завершить задачу или перенести/уточнить дедлайн`,
      );
    }
    lines.push("");
  }

  if (inProgressRows.length > 0) {
    lines.push("### В работе без обновлений (> 1 раб. дня)", "");
    for (const { card, rule } of inProgressRows.slice(0, 20)) {
      const t = card.task;
      const lastAt = computeLastActivityAt(t);
      const hours = businessHoursSince(lastAt);
      lines.push(
        taskLine(card),
        `  - статус: ${t.status ?? "—"} | lastActivityAt: ${lastAt ?? "—"}`,
        `  - без активности: ${hours != null ? formatHoursLabel(hours) : "—"}`,
        `  - исполнитель: ${t.assignees.join(", ") || "—"}`,
        `  - исправить: обновить статус или оставить комментарий с прогрессом`,
      );
    }
    lines.push("");
  }

  if (reviewRows.length > 0) {
    lines.push("### На проверке > 1 раб. дня", "");
    const resolve = makeStateNameResolver(result.meta.stateNameByKey);
    for (const { card, rule } of reviewRows.slice(0, 20)) {
      const t = card.task;
      const review = findReviewStartedAt(t, resolve);
      const refAt = review?.at ?? computeLastActivityAt(t);
      const hours = businessHoursSince(refAt);
      lines.push(
        taskLine(card),
        `  - статус: ${t.status ?? "—"} | reviewStartedAt: ${refAt ?? "—"} (confidence=${review?.confidence ?? "fallback_update_time"})`,
        `  - на проверке: ${hours != null ? formatHoursLabel(hours) : "—"}`,
        `  - исполнитель: ${t.assignees.join(", ") || "—"}`,
        `  - исправить: провести QA или вернуть с причиной`,
      );
    }
    lines.push("");
  }

  if (criticalRows.length > 0) {
    lines.push("### Высокий приоритет / critical bug без движения (> 24 ч)", "");
    for (const { card, rule } of criticalRows.slice(0, 20)) {
      const t = card.task;
      const hp = isHighPriorityOrCriticalBug(t);
      const lastAt = computeLastActivityAt(t);
      lines.push(
        taskLine(card),
        `  - priority/tags: ${t.priority ?? "—"} / ${t.tags.join(", ") || "—"}`,
        `  - marker: ${hp.marker || "—"} | lastActivityAt: ${lastAt ?? "—"}`,
        `  - ${rule.reason}`,
        `  - исправить: назначить ответственного и обновить задачу`,
      );
    }
  }

  return lines;
}

export function buildTestingQueueMarkdown(
  result: AuditResult,
  boardMetrics?: BoardAuditMetrics,
): string[] {
  const lines: string[] = ["", "## Очередь тестирования", ""];
  const metrics = boardMetrics ?? result.meta.boardMetrics;
  if (!metrics) {
    lines.push("_Метрики очереди недоступны._");
    return lines;
  }

  const overloaded = Object.values(metrics.byBoard).filter(
    (b) => b.testingQueueCount > b.testingQueueMax,
  );

  if (overloaded.length === 0) {
    lines.push(
      `_Очередь на тестирование в норме (лимит ${metrics.reviewQueueMax} задач на доску)._`,
    );
    return lines;
  }

  for (const board of overloaded.sort((a, b) =>
    a.boardId.localeCompare(b.boardId, undefined, { numeric: true }),
  )) {
    lines.push(
      `- **Доска ${board.boardId}**: ${board.testingQueueCount} задач на проверке (лимит ${board.testingQueueMax})`,
      `  - рекомендация: разгрузить очередь / назначить QA / приоритизировать проверку`,
    );
    for (const sample of board.sampleTasks.slice(0, 10)) {
      lines.push(
        `  - [№${sample.id}](${sample.url}) — ${sample.title ?? "(без названия)"}`,
      );
    }
    lines.push("");
  }

  return lines;
}

export function buildReworkCommentRow(
  card: CardAudit,
  rule: RuleResult,
): string[] {
  const t = card.task;
  const transitions = findReworkTransitions(t);
  const latest = transitions[0];
  return [
    taskLine(card),
    `  - rule: \`${rule.ruleId}\` (${ruleLabel(rule.ruleId)}) — ${rule.status}`,
    latest
      ? `  - возврат: ${latest.fromStatus} → ${latest.toStatus} | ${latest.at.slice(0, 10)} | ${latest.userName ?? latest.userId ?? "—"}`
      : `  - ${rule.reason}`,
    `  - исправить: описать причину возврата в комментарии`,
  ];
}

export const STALE_STATUS_RULE_ID_SET = STALE_STATUS_RULE_IDS;
