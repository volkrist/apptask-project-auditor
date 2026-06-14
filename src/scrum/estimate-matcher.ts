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
    .replace(/ё/g, "е")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[^\p{L}\p{N}\s:./-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowMatchTitle(row: ScrumEstimateRow): string {
  return row.fullTitle || row.title;
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

  const exactFull = rows.find(
    (r) => fullTitleForMatch(rowMatchTitle(r)) === taskFull,
  );
  if (exactFull) return { kind: "ok", row: exactFull };

  const coreExact = rows.filter(
    (r) => coreTitleForMatch(rowMatchTitle(r)) === taskCore,
  );
  if (coreExact.length === 1) {
    return { kind: "ok", row: coreExact[0]! };
  }

  if (taskCode) {
    const sameCode = rows.filter((r) => {
      const rc = parseTaskCodeAndTitle(rowMatchTitle(r)).code || r.code;
      return rc === taskCode;
    });
    if (sameCode.length === 1) {
      const row = sameCode[0]!;
      if (coreTitleForMatch(rowMatchTitle(row)) === taskCore) {
        return { kind: "ok", row };
      }
      return {
        kind: "title_mismatch",
        row,
        taskTitle: task.title,
        estimateTitle: rowMatchTitle(row),
      };
    }
    if (sameCode.length > 1) {
      const coreHit = sameCode.find(
        (r) => coreTitleForMatch(rowMatchTitle(r)) === taskCore,
      );
      if (coreHit) return { kind: "ok", row: coreHit };
      return {
        kind: "title_mismatch",
        row: sameCode[0]!,
        taskTitle: task.title,
        estimateTitle: rowMatchTitle(sameCode[0]!),
      };
    }
  }

  const coreMatches = rows.filter((r) => {
    const rowFull = fullTitleForMatch(rowMatchTitle(r));
    const rowCore = coreTitleForMatch(rowMatchTitle(r));
    return (
      rowCore === taskCore ||
      rowFull === taskCore ||
      (taskFull.length > 0 && rowFull === taskFull)
    );
  });

  if (coreMatches.length === 1) {
    const row = coreMatches[0]!;
    if (fullTitleForMatch(rowMatchTitle(row)) !== taskFull) {
      return {
        kind: "title_mismatch",
        row,
        taskTitle: task.title,
        estimateTitle: rowMatchTitle(row),
      };
    }
    return { kind: "ok", row };
  }

  if (coreMatches.length > 1) {
    const exactAmong = coreMatches.find(
      (r) => fullTitleForMatch(rowMatchTitle(r)) === taskFull,
    );
    if (exactAmong) return { kind: "ok", row: exactAmong };
    return {
      kind: "title_mismatch",
      row: coreMatches[0]!,
      taskTitle: task.title,
      estimateTitle: rowMatchTitle(coreMatches[0]!),
    };
  }

  if (taskCore.length >= 8) {
    const fuzzy = rows.filter((r) => {
      const rowCore = coreTitleForMatch(rowMatchTitle(r));
      return rowCore.includes(taskCore) || taskCore.includes(rowCore);
    });
    if (fuzzy.length === 1) {
      const row = fuzzy[0]!;
      if (fullTitleForMatch(rowMatchTitle(row)) !== taskFull) {
        return {
          kind: "title_mismatch",
          row,
          taskTitle: task.title,
          estimateTitle: rowMatchTitle(row),
        };
      }
      return { kind: "ok", row };
    }
  }

  return { kind: "not_found" };
}

export type ScrumMatchStats = {
  matched: number;
  notFound: number;
  nameMismatch: number;
  noPv: number;
  over20NoDecomp: number;
  matchExamples: Array<{ apptask: string; scrum: string; sheet: string }>;
  mismatchExamples: Array<{ apptask: string; kind: string; scrum?: string }>;
};

export function computeScrumMatchStats(
  tasks: RawTask[],
  rows: ScrumEstimateRow[],
  threshold = 20,
): ScrumMatchStats {
  const stats: ScrumMatchStats = {
    matched: 0,
    notFound: 0,
    nameMismatch: 0,
    noPv: 0,
    over20NoDecomp: 0,
    matchExamples: [],
    mismatchExamples: [],
  };

  for (const task of tasks) {
    if (!task.title?.trim()) continue;
    const match = matchTaskToEstimate(task, rows);
    if (match.kind === "ok") {
      stats.matched++;
      if (stats.matchExamples.length < 5) {
        stats.matchExamples.push({
          apptask: task.title,
          scrum: match.row.fullTitle || match.row.title,
          sheet: match.row.sourceSheet,
        });
      }
      const hours = match.row.estimateHours ?? match.row.plannedHours;
      if (hours == null || hours <= 0) stats.noPv++;
      const hasSub = Boolean(
        match.row.subtaskTitle?.trim() || match.row.subTask?.trim(),
      );
      if (hours != null && hours > threshold && !hasSub) stats.over20NoDecomp++;
    } else if (match.kind === "title_mismatch") {
      stats.nameMismatch++;
      stats.matched++;
      if (stats.mismatchExamples.length < 5) {
        stats.mismatchExamples.push({
          apptask: task.title,
          kind: "title_mismatch",
          scrum: match.estimateTitle,
        });
      }
    } else {
      stats.notFound++;
      if (stats.mismatchExamples.length < 5) {
        stats.mismatchExamples.push({
          apptask: task.title,
          kind: "not_found",
        });
      }
    }
  }

  return stats;
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
