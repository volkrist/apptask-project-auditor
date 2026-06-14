import type { RawTask, TaskComment } from "../adapters/apptask/types.js";
import { loadAuditConfig } from "../config/audit-config.js";
import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import {
  commentPlainTextForRules,
  findUnresolvedQuestionInCard,
} from "../rules/helpers.js";
import { findVagueDoneComments } from "../rules/status/status-helpers.js";
import { findReworkTransitions } from "../rules/history/history-parser.js";
import { buildReworkCommentRow } from "./structured-findings.js";
import { ruleLabel } from "./rule-labels.js";

/** Правила основного audit flow, связанные с комментариями (не Google/Scrum). */
export const COMMENT_AUDIT_RULE_IDS = new Set<string>([
  "unresolved_question_keywords_in_card",
  "vague_done_comment",
  "blocked_task_reason",
  "rework_without_reason",
]);

export type CommentIssueRow = {
  boardId: string;
  taskId: string;
  taskUrl: string;
  taskTitle: string;
  ruleId: string;
  status: "FAIL" | "WARN";
  marker: string;
  commentAuthor: string;
  commentDate: string;
  fixHint: string;
};

const FIX_HINTS: Record<string, string> = {
  unresolved_question_keywords_in_card:
    "Закрыть вопрос в комментарии или снять маркер после получения ответа",
  vague_done_comment:
    "Добавить детали: что сделано, ссылку на PR, скрин или результат проверки",
  blocked_task_reason:
    "Описать причину блокировки в комментарии (конкретно, не одно слово)",
  rework_without_reason:
    "Описать причину возврата на доработку в комментарии рядом с изменением статуса",
};

function formatCommentDate(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  return value.slice(0, 10);
}

function commentAuthor(comment: TaskComment | undefined): string {
  if (!comment) return "—";
  return (
    comment.creatorName?.trim() ||
    (comment.creatorId != null ? `user:${comment.creatorId}` : "—")
  );
}

function findCommentWithKeyword(
  task: RawTask,
  keyword: string,
): TaskComment | undefined {
  for (const comment of task.comments ?? []) {
    const plain = commentPlainTextForRules(comment);
    if (plain.toLowerCase().includes(keyword.toLowerCase())) {
      return comment;
    }
  }
  return undefined;
}

function issueFromRule(
  card: CardAudit,
  rule: RuleResult,
  configKeywords: readonly string[],
): CommentIssueRow | null {
  const task = card.task;
  const boardId = task.boardId ?? "?";
  const taskId = task.id ?? "?";
  const base = {
    boardId,
    taskId,
    taskUrl: task.url ?? "—",
    taskTitle: task.title ?? "(без названия)",
    ruleId: rule.ruleId,
    status: rule.status as "FAIL" | "WARN",
    fixHint: FIX_HINTS[rule.ruleId] ?? "Уточнить комментарий",
  };

  if (rule.ruleId === "vague_done_comment") {
    const vague = findVagueDoneComments(task)[0];
    return {
      ...base,
      marker: vague ? commentPlainTextForRules(vague).slice(0, 80) : rule.reason,
      commentAuthor: commentAuthor(vague),
      commentDate: formatCommentDate(vague?.createTime),
    };
  }

  if (rule.ruleId === "blocked_task_reason") {
    return {
      ...base,
      marker: "блокировка без причины в комментариях",
      commentAuthor: "—",
      commentDate: "—",
    };
  }

  if (rule.ruleId === "unresolved_question_keywords_in_card") {
    const hit = findUnresolvedQuestionInCard(task, configKeywords);
    if (!hit || hit.source !== "comment") {
      return null;
    }
    const comment = findCommentWithKeyword(task, hit.keyword);
    return {
      ...base,
      marker: hit.keyword,
      commentAuthor: commentAuthor(comment),
      commentDate: formatCommentDate(comment?.createTime),
    };
  }

  if (rule.ruleId === "rework_without_reason") {
    const transitions = findReworkTransitions(task);
    const latest = transitions[0];
    return {
      ...base,
      marker: latest
        ? `${latest.fromStatus} → ${latest.toStatus}`
        : rule.reason,
      commentAuthor: latest?.userName ?? (latest?.userId != null ? `user:${latest.userId}` : "—"),
      commentDate: formatCommentDate(latest?.at),
    };
  }

  return null;
}

export function collectCommentIssues(result: AuditResult): CommentIssueRow[] {
  const config = loadAuditConfig();
  const rows: CommentIssueRow[] = [];

  for (const card of result.cards) {
    for (const rule of card.results) {
      if (rule.status === "PASS") continue;
      if (!COMMENT_AUDIT_RULE_IDS.has(rule.ruleId)) continue;
      const row = issueFromRule(card, rule, config.unresolvedQuestionKeywords);
      if (row) rows.push(row);
    }
  }

  rows.sort(
    (a, b) =>
      a.boardId.localeCompare(b.boardId, undefined, { numeric: true }) ||
      a.taskId.localeCompare(b.taskId, undefined, { numeric: true }),
  );
  return rows;
}

export function buildCommentIssuesMarkdown(result: AuditResult): string[] {
  const issues = collectCommentIssues(result);
  const lines: string[] = ["", "## Проблемы по комментариям", ""];

  if (issues.length === 0) {
    lines.push(
      "_Нарушений по комментариям не найдено (маркеры только в названии/описании не попадают в этот раздел)._",
    );
    return lines;
  }

  for (const issue of issues) {
    if (issue.ruleId === "rework_without_reason") {
      const card = result.cards.find((c) => c.task.id === issue.taskId);
      if (card) {
        const rule = card.results.find((r) => r.ruleId === issue.ruleId);
        if (rule) {
          lines.push(...buildReworkCommentRow(card, rule));
          continue;
        }
      }
    }
    lines.push(
      `- **Доска ${issue.boardId}** | [№${issue.taskId}](${issue.taskUrl}) — ${issue.taskTitle}`,
      `  - rule: \`${issue.ruleId}\` (${ruleLabel(issue.ruleId)}) — ${issue.status}`,
      `  - маркер: ${issue.marker}`,
      `  - автор: ${issue.commentAuthor} | дата: ${issue.commentDate}`,
      `  - исправить: ${issue.fixHint}`,
    );
  }

  return lines;
}
