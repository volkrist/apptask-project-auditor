import type { RawTask } from "../adapters/apptask/types.js";
import type { CardAudit } from "../rules/rule-types.js";

/** single — одна доска из boardUrl; multi — все APPTASK_DB_BOARD_IDS (только DB collector). */
export type AuditScope = "single" | "multi";

export type BoardAuditSummary = {
  boardId: string;
  boardUrl: string;
  tasksChecked: number;
  tasksAvailable: number;
  failCount: number;
  warnCount: number;
};

export type AuditScopeMeta = {
  auditScope: AuditScope;
  /** maxCards — лимит задач суммарно по всем доскам (round-robin). */
  maxCardsScope: "total";
  boardIds: string[];
};

export function loadAuditScope(): AuditScope {
  const v = process.env.APPTASK_AUDIT_SCOPE?.trim().toLowerCase();
  if (v === "multi" || v === "all") return "multi";
  return "single";
}

function countCardIssues(card: CardAudit): { fail: number; warn: number } {
  let fail = 0;
  let warn = 0;
  for (const r of card.results) {
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
  }
  return { fail, warn };
}

export function buildBoardSummaries(
  cards: CardAudit[],
  availableByBoard: Record<string, number>,
  appTaskBaseUrl: string,
): BoardAuditSummary[] {
  const checked = new Map<string, CardAudit[]>();
  for (const card of cards) {
    const boardId = card.task.boardId ?? "?";
    const list = checked.get(boardId) ?? [];
    list.push(card);
    checked.set(boardId, list);
  }

  const boardIds = [
    ...new Set([
      ...Object.keys(availableByBoard),
      ...checked.keys(),
    ]),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return boardIds.map((boardId) => {
    const boardCards = checked.get(boardId) ?? [];
    let failCount = 0;
    let warnCount = 0;
    for (const card of boardCards) {
      const c = countCardIssues(card);
      failCount += c.fail;
      warnCount += c.warn;
    }
    return {
      boardId,
      boardUrl: `${appTaskBaseUrl.replace(/\/$/, "")}/board/${boardId}`,
      tasksChecked: boardCards.length,
      tasksAvailable: availableByBoard[boardId] ?? boardCards.length,
      failCount,
      warnCount,
    };
  }).filter((s) => s.tasksChecked > 0 || s.tasksAvailable > 0);
}

/** Равномерно берёт до maxCards задач с нескольких досок (round-robin по boardIds). */
export function limitTasksMultiBoard(
  tasks: RawTask[],
  boardIds: number[],
  maxCards: number,
): RawTask[] {
  if (maxCards <= 0 || tasks.length <= maxCards) return tasks;

  const byBoard = new Map<string, RawTask[]>();
  for (const t of tasks) {
    const key = t.boardId ?? "?";
    const list = byBoard.get(key) ?? [];
    list.push(t);
    byBoard.set(key, list);
  }

  const orderedBoards = boardIds
    .map(String)
    .filter((id) => (byBoard.get(id)?.length ?? 0) > 0);

  const picked: RawTask[] = [];
  const index = new Map<string, number>();
  for (const id of orderedBoards) index.set(id, 0);

  while (picked.length < maxCards) {
    let added = false;
    for (const id of orderedBoards) {
      if (picked.length >= maxCards) break;
      const list = byBoard.get(id)!;
      const i = index.get(id)!;
      if (i < list.length) {
        picked.push(list[i]!);
        index.set(id, i + 1);
        added = true;
      }
    }
    if (!added) break;
  }

  return picked;
}

export function countTasksByBoard(tasks: RawTask[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    const id = t.boardId ?? "?";
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
