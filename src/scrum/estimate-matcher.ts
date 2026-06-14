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
  | {
      kind: "title_mismatch";
      row: ScrumEstimateRow;
      taskTitle: string;
      estimateTitle: string;
    }
  | { kind: "not_found" };

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
    .replace(/&nbsp;/gi, " ")
    .replace(/[^\p{L}\p{N}\s:./-]+/gu, " ")
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

export function coreTitleForMatch(title: string | null | undefined): string {
  if (!title?.trim()) return "";
  const { titlePart } = parseTaskCodeAndTitle(title);
  const core = titlePart.trim() || title.trim();
  return normalizeMatchText(core);
}

export function fullTitleForMatch(title: string | null | undefined): string {
  return normalizeMatchText(title ?? "");
}

export function matchTaskToEstimate(
  task: RawTask,
  rows: ScrumEstimateRow[],
): EstimateMatchResult {
  if (!task.title?.trim()) return { kind: "not_found" };

  const taskFull = fullTitleForMatch(task.title);
  const taskCore = coreTitleForMatch(task.title);
  const { code: taskCode } = parseTaskCodeAndTitle(task.title);

  const exactFull = rows.find((r) => fullTitleForMatch(r.title) === taskFull);
  if (exactFull) return { kind: "ok", row: exactFull };

  const coreExact = rows.filter((r) => coreTitleForMatch(r.title) === taskCore);
  if (coreExact.length === 1) {
    return { kind: "ok", row: coreExact[0]! };
  }

  if (taskCode) {
    const sameCode = rows.filter((r) => {
      const rc = parseTaskCodeAndTitle(r.title).code || r.code;
      return rc === taskCode;
    });
    if (sameCode.length === 1) {
      const row = sameCode[0]!;
      if (coreTitleForMatch(row.title) === taskCore) {
        return { kind: "ok", row };
      }
      return {
        kind: "title_mismatch",
        row,
        taskTitle: task.title,
        estimateTitle: row.title,
      };
    }
    if (sameCode.length > 1) {
      const coreHit = sameCode.find(
        (r) => coreTitleForMatch(r.title) === taskCore,
      );
      if (coreHit) return { kind: "ok", row: coreHit };
      return {
        kind: "title_mismatch",
        row: sameCode[0]!,
        taskTitle: task.title,
        estimateTitle: sameCode[0]!.title,
      };
    }
  }

  const coreMatches = rows.filter((r) => {
    const rowFull = fullTitleForMatch(r.title);
    const rowCore = coreTitleForMatch(r.title);
    return (
      rowCore === taskCore ||
      rowFull === taskCore ||
      (taskFull.length > 0 && rowFull === taskFull)
    );
  });

  if (coreMatches.length === 1) {
    const row = coreMatches[0]!;
    if (fullTitleForMatch(row.title) !== taskFull) {
      return {
        kind: "title_mismatch",
        row,
        taskTitle: task.title,
        estimateTitle: row.title,
      };
    }
    return { kind: "ok", row };
  }

  if (coreMatches.length > 1) {
    const exactAmong = coreMatches.find(
      (r) => fullTitleForMatch(r.title) === taskFull,
    );
    if (exactAmong) return { kind: "ok", row: exactAmong };
    return {
      kind: "title_mismatch",
      row: coreMatches[0]!,
      taskTitle: task.title,
      estimateTitle: coreMatches[0]!.title,
    };
  }

  if (taskCore.length >= 8) {
    const fuzzy = rows.filter((r) => {
      const rowCore = coreTitleForMatch(r.title);
      return rowCore.includes(taskCore) || taskCore.includes(rowCore);
    });
    if (fuzzy.length === 1) {
      const row = fuzzy[0]!;
      if (fullTitleForMatch(row.title) !== taskFull) {
        return {
          kind: "title_mismatch",
          row,
          taskTitle: task.title,
          estimateTitle: row.title,
        };
      }
      return { kind: "ok", row };
    }
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
