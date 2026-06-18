import type { RawTask, TaskHistoryEntry } from "../../adapters/apptask/types.js";
import type { StateNameResolver } from "../../collectors/state-map.js";
import { resolveStateLabel } from "../../collectors/state-map.js";
import {
  IN_PROGRESS_STATUS_RE,
  TESTING_STATUS_RE,
  isInProgressStatus,
  isTestingStatus,
} from "../status/status-helpers.js";

export type { StateNameResolver };

export type HistoryPropertyChange = {
  name: string;
  oldValue: unknown;
  newValue: unknown;
};

export type ParsedHistoryEntry = {
  id?: number | string;
  date: string | null;
  userId?: number | string | null;
  userName?: string | null;
  actionType?: number | string | null;
  changes: HistoryPropertyChange[];
  rawData?: string;
};

const STATE_PROP_NAMES =
  /^(state|status|stateid|state_id|statusname|status_name|boardstate)/i;

export function parseHistoryData(data: string | null | undefined): HistoryPropertyChange[] {
  if (!data?.trim()) return [];
  try {
    const parsed = JSON.parse(data) as {
      PropertyList?: Array<{
        Name?: string;
        OldValue?: unknown;
        NewValue?: unknown;
      }>;
    };
    const list = parsed.PropertyList ?? [];
    return list
      .filter((p) => p.Name)
      .map((p) => ({
        name: String(p.Name),
        oldValue: p.OldValue,
        newValue: p.NewValue,
      }));
  } catch {
    return [];
  }
}

export function parseHistoryEntry(entry: TaskHistoryEntry): ParsedHistoryEntry {
  return {
    id: entry.id,
    date: entry.date ?? null,
    userId: entry.userId,
    userName: entry.userName,
    actionType: entry.actionType,
    changes: parseHistoryData(entry.data),
    rawData: entry.data ?? undefined,
  };
}

function isStateChange(change: HistoryPropertyChange): boolean {
  return STATE_PROP_NAMES.test(change.name);
}

export function extractStatusFromChanges(
  changes: HistoryPropertyChange[],
  boardId?: string | null,
  resolve?: StateNameResolver,
): { from: string; to: string } | null {
  for (const c of changes) {
    if (!isStateChange(c)) continue;
    const from = resolveStateLabel(c.oldValue, boardId, resolve);
    const to = resolveStateLabel(c.newValue, boardId, resolve);
    if (from || to) return { from, to };
  }
  return null;
}

export type ReviewStartedInfo = {
  at: string;
  source: "history" | "fallback_update_time";
  confidence: "history" | "fallback_update_time";
};

export function findReviewStartedAt(
  task: RawTask,
  resolve?: StateNameResolver,
): ReviewStartedInfo | null {
  if (!isTestingStatus(task.status)) return null;

  const entries = [...(task.history ?? [])].sort((a, b) => {
    const ta = new Date(a.date ?? 0).getTime();
    const tb = new Date(b.date ?? 0).getTime();
    return tb - ta;
  });

  for (const entry of entries) {
    const parsed = parseHistoryEntry(entry);
    const statusChange = extractStatusFromChanges(
      parsed.changes,
      task.boardId,
      resolve,
    );
    if (!statusChange) continue;
    const to = statusChange.to;
    if (TESTING_STATUS_RE.test(to) && !TESTING_STATUS_RE.test(statusChange.from)) {
      if (entry.date) {
        return {
          at: entry.date,
          source: "history",
          confidence: "history",
        };
      }
    }
  }

  if (task.updatedAt) {
    return {
      at: task.updatedAt,
      source: "fallback_update_time",
      confidence: "fallback_update_time",
    };
  }
  return null;
}

export type ReworkTransition = {
  at: string;
  fromStatus: string;
  toStatus: string;
  userId?: number | string | null;
  userName?: string | null;
  historyId?: number | string;
};

export function findReworkTransitions(
  task: RawTask,
  resolve?: StateNameResolver,
): ReworkTransition[] {
  const found: ReworkTransition[] = [];
  for (const entry of task.history ?? []) {
    const parsed = parseHistoryEntry(entry);
    const statusChange = extractStatusFromChanges(
      parsed.changes,
      task.boardId,
      resolve,
    );
    if (!statusChange || !entry.date) continue;
    const fromReview =
      TESTING_STATUS_RE.test(statusChange.from) ||
      /\bqa\b/i.test(statusChange.from);
    const toWork =
      IN_PROGRESS_STATUS_RE.test(statusChange.to) ||
      /доработ|новая/i.test(statusChange.to);
    if (fromReview && toWork) {
      found.push({
        at: entry.date,
        fromStatus: statusChange.from,
        toStatus: statusChange.to,
        userId: entry.userId,
        userName: entry.userName,
        historyId: entry.id,
      });
    }
  }
  return found.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}

/** Первый переход в «в работе» по history (для never_started). */
export function findInProgressStartedAt(
  task: RawTask,
  resolve?: StateNameResolver,
): { at: string } | null {
  for (const entry of task.history ?? []) {
    const parsed = parseHistoryEntry(entry);
    const statusChange = extractStatusFromChanges(
      parsed.changes,
      task.boardId,
      resolve,
    );
    if (!statusChange || !entry.date) continue;
    if (
      IN_PROGRESS_STATUS_RE.test(statusChange.to) &&
      !IN_PROGRESS_STATUS_RE.test(statusChange.from)
    ) {
      return { at: entry.date };
    }
  }
  if (isInProgressStatus(task.status) && task.updatedAt) {
    return { at: task.updatedAt };
  }
  return null;
}

export function summarizeActionTypes(
  histories: TaskHistoryEntry[],
): Map<string | number, number> {
  const counts = new Map<string | number, number>();
  for (const h of histories) {
    const key = h.actionType ?? "?";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
