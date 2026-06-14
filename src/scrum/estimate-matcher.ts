import type { RawTask } from "../adapters/apptask/types.js";
import {
  countTestingQueueTasks,
  daysUntilDue,
  hasAdequateBlockReason,
  isBlockedTask,
  isCompletedStatus,
  isHighPriorityOrCriticalBug,
  isInProgressStatus,
  isReviewStatus,
  isTestingStatus,
  isVagueDoneCommentText,
  parseRuDateToMs,
} from "../rules/status/status-helpers.js";
import { extractCodeFromTitle } from "./google-sheets-reader.js";
import type { ScrumEstimateRow } from "./scrum-estimate-config.js";

export type EstimateMatchResult =
  | { kind: "ok"; row: ScrumEstimateRow }
  | { kind: "code_title_mismatch"; row: ScrumEstimateRow; taskTitle: string }
  | { kind: "not_found" }
  | { kind: "similar_title"; candidates: ScrumEstimateRow[] };

export {
  countTestingQueueTasks,
  daysUntilDue,
  isBlockedTask,
  isCompletedStatus,
  isHighPriorityOrCriticalBug,
  isInProgressStatus,
  isReviewStatus,
  isTestingStatus,
  parseRuDateToMs,
};

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTaskCodeAndTitle(title: string | null): {
  code: string | null;
  titlePart: string;
} {
  if (!title?.trim()) return { code: null, titlePart: "" };
  const m = title.trim().match(/^(\d+(?:\.\d+)+)\s*(.*)$/);
  if (m) {
    return { code: m[1]!, titlePart: m[2]?.trim() ?? "" };
  }
  return { code: extractCodeFromTitle(title), titlePart: title.trim() };
}

export function matchTaskToEstimate(
  task: RawTask,
  rows: ScrumEstimateRow[],
): EstimateMatchResult {
  const { code, titlePart } = parseTaskCodeAndTitle(task.title);
  const normTaskTitle = normalizeMatchText(titlePart || task.title || "");

  if (code) {
    const byCode = rows.filter((r) => r.code === code || r.title.startsWith(code));
    if (byCode.length === 1) {
      const row = byCode[0]!;
      const normRow = normalizeMatchText(
        row.title.replace(new RegExp(`^${code}\\s*`), ""),
      );
      if (normRow && normTaskTitle && normRow !== normTaskTitle) {
        return { kind: "code_title_mismatch", row, taskTitle: task.title ?? "" };
      }
      return { kind: "ok", row };
    }
    if (byCode.length > 1) {
      const exact = byCode.find(
        (r) => normalizeMatchText(r.title) === normalizeMatchText(task.title ?? ""),
      );
      if (exact) return { kind: "ok", row: exact };
      return { kind: "code_title_mismatch", row: byCode[0]!, taskTitle: task.title ?? "" };
    }
  }

  const normFull = normalizeMatchText(task.title ?? "");
  const exactTitle = rows.find(
    (r) => normalizeMatchText(r.title) === normFull,
  );
  if (exactTitle) return { kind: "ok", row: exactTitle };

  const similar = rows.filter((r) => {
    const nt = normalizeMatchText(r.title);
    return nt.includes(normFull) || normFull.includes(nt);
  });
  if (similar.length > 0) {
    return { kind: "similar_title", candidates: similar.slice(0, 3) };
  }

  return { kind: "not_found" };
}

export function countReviewQueueTasks(tasks: RawTask[]): number {
  return countTestingQueueTasks(tasks).length;
}

export function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

export function isVagueDoneComment(text: string): boolean {
  return isVagueDoneCommentText(text);
}

export function hasBlockReasonInComments(task: RawTask): boolean {
  return hasAdequateBlockReason(task);
}

export function isHighPriorityTask(task: RawTask): boolean {
  return isHighPriorityOrCriticalBug(task).match;
}
