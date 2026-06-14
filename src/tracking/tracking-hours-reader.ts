import type { DbConfig } from "../collectors/db-config.js";
import { boardIdsInClause, querySelect } from "../collectors/db-client.js";
import { businessHoursSince } from "../rules/status/status-helpers.js";

export function taskTrackingKey(
  boardId: string | number,
  taskId: string | number,
): string {
  return `${boardId}:${taskId}`;
}

function rowDateMs(value: Date | string): number | null {
  const d = value instanceof Date ? value : new Date(value);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function sumActualMs(totalTime: number | null | undefined): number {
  return Number(totalTime) || 0;
}

function sumAppendMs(appendTotalTime: number | null | undefined): number {
  return Number(appendTotalTime) || 0;
}

export function computeRecentTrackingFlags(
  rows: TrackingSummaryRow[],
  nowMs = Date.now(),
): {
  hasTrackingInLast24Hours: boolean;
  hasTrackingInLastBusinessDay: boolean;
} {
  const dayMs = 24 * 60 * 60 * 1000;
  let hasTrackingInLast24Hours = false;
  let latestDate: string | null = null;

  for (const row of rows) {
    const ms = rowDateMs(row.date);
    if (ms != null && ms >= nowMs - dayMs) {
      hasTrackingInLast24Hours = true;
    }
    const d = formatTrackingDate(row.date);
    if (d && (!latestDate || d > latestDate)) latestDate = d;
  }

  const businessHours = latestDate ? businessHoursSince(latestDate) : null;
  const hasTrackingInLastBusinessDay =
    businessHours != null && businessHours <= 8;

  return { hasTrackingInLast24Hours, hasTrackingInLastBusinessDay };
}

/** Raw row shape from UserTrackingSummaries (+ optional user name). */
export type TrackingSummaryRow = {
  board_id: number;
  task_id: number | null;
  user_id: number;
  user_name: string | null;
  total_time: number | null;
  append_total_time: number | null;
  date: Date | string;
  removed: boolean | number | null;
};

export type UserTaskTrackingHours = {
  userId: number;
  userName: string | null;
  /** total_time only (ms). */
  actualMs: number;
  actualHours: number;
  firstDate: string | null;
  lastDate: string | null;
  /** @deprecated use actualMs */
  totalMs: number;
  /** @deprecated use actualHours */
  totalHours: number;
};

export type TaskTrackingHours = {
  boardId: number;
  taskId: number;
  /** SUM(total_time) ms — used for rules and UI-aligned actual hours. */
  actualMs: number;
  actualHours: number;
  /** SUM(append_total_time) ms — manual append, not in UI card total. */
  manualAppendMs: number;
  manualAppendHours: number;
  usersCount: number;
  trackingDaysCount: number;
  firstTrackingDate: string | null;
  lastTrackingDate: string | null;
  hasTrackingInLast24Hours: boolean;
  hasTrackingInLastBusinessDay: boolean;
  perUser: UserTaskTrackingHours[];
  /** @deprecated use actualMs */
  totalMs: number;
  /** @deprecated use actualHours */
  totalHours: number;
};

export type TaskTrackingMeta = {
  boardId: number;
  taskId: number;
  title: string | null;
  statusName: string | null;
  assigneeNames: string[];
};

export type TaskTrackingProbeRow = TaskTrackingHours & {
  title: string | null;
  statusName: string | null;
  assigneeNames: string[];
  rawTotalTimeMs: number;
  rawAppendTotalTimeMs: number;
  taskUrl: string;
};

export type LoadTaskTrackingHoursOptions = {
  taskIds?: number[];
  boardId?: number;
};

/** JOIN clause used for all tracking-hours reads (task + board composite key). */
export const TRACKING_HOURS_BOARD_TASK_JOIN = `
INNER JOIN dbo.BoardTasks bt
  ON uts.task_id = bt.id AND uts.board_id = bt.board_id
`;

export function sumTrackingMs(
  totalTime: number | null | undefined,
  appendTotalTime: number | null | undefined,
): number {
  return (Number(totalTime) || 0) + (Number(appendTotalTime) || 0);
}

export function msToHours(ms: number): number {
  return ms / 3_600_000;
}

export function formatTrackingDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function trackingDayKey(value: Date | string): string {
  const formatted = formatTrackingDate(value);
  return formatted?.slice(0, 10) ?? String(value).slice(0, 10);
}

export function isTrackingRowIncluded(
  row: TrackingSummaryRow,
  boardIds: number[],
): boolean {
  if (row.task_id == null) return false;
  if (row.removed === true || row.removed === 1) return false;
  return boardIds.includes(row.board_id);
}

/** Pure aggregation for unit tests and in-memory grouping after SQL fetch. */
export function aggregateTrackingByTask(
  rows: TrackingSummaryRow[],
  boardIds: number[],
): TaskTrackingHours[] {
  const included = rows.filter((r) => isTrackingRowIncluded(r, boardIds));
  const byTask = new Map<string, TrackingSummaryRow[]>();

  for (const row of included) {
    const key = `${row.board_id}:${row.task_id}`;
    const list = byTask.get(key) ?? [];
    list.push(row);
    byTask.set(key, list);
  }

  const results: TaskTrackingHours[] = [];

  for (const taskRows of byTask.values()) {
    const first = taskRows[0]!;
    const boardId = first.board_id;
    const taskId = first.task_id!;

    const byUser = new Map<number, TrackingSummaryRow[]>();
    const dayKeys = new Set<string>();
    let minDate: string | null = null;
    let maxDate: string | null = null;
    let actualMs = 0;
    let manualAppendMs = 0;

    for (const row of taskRows) {
      actualMs += sumActualMs(row.total_time);
      manualAppendMs += sumAppendMs(row.append_total_time);
      dayKeys.add(trackingDayKey(row.date));
      const d = formatTrackingDate(row.date);
      if (d && (!minDate || d < minDate)) minDate = d;
      if (d && (!maxDate || d > maxDate)) maxDate = d;

      const userList = byUser.get(row.user_id) ?? [];
      userList.push(row);
      byUser.set(row.user_id, userList);
    }

    const recent = computeRecentTrackingFlags(taskRows);

    const perUser: UserTaskTrackingHours[] = [...byUser.entries()]
      .map(([userId, userRows]) => {
        let userActualMs = 0;
        let userMin: string | null = null;
        let userMax: string | null = null;
        for (const r of userRows) {
          userActualMs += sumActualMs(r.total_time);
          const d = formatTrackingDate(r.date);
          if (d && (!userMin || d < userMin)) userMin = d;
          if (d && (!userMax || d > userMax)) userMax = d;
        }
        const userActualHours = msToHours(userActualMs);
        return {
          userId,
          userName: userRows[0]?.user_name ?? null,
          actualMs: userActualMs,
          actualHours: userActualHours,
          firstDate: userMin,
          lastDate: userMax,
          totalMs: userActualMs,
          totalHours: userActualHours,
        };
      })
      .sort((a, b) => b.actualMs - a.actualMs);

    const actualHours = msToHours(actualMs);
    results.push({
      boardId,
      taskId,
      actualMs,
      actualHours,
      manualAppendMs,
      manualAppendHours: msToHours(manualAppendMs),
      usersCount: perUser.length,
      trackingDaysCount: dayKeys.size,
      firstTrackingDate: minDate,
      lastTrackingDate: maxDate,
      hasTrackingInLast24Hours: recent.hasTrackingInLast24Hours,
      hasTrackingInLastBusinessDay: recent.hasTrackingInLastBusinessDay,
      perUser,
      totalMs: actualMs,
      totalHours: actualHours,
    });
  }

  return results.sort((a, b) =>
    a.boardId !== b.boardId
      ? a.boardId - b.boardId
      : a.taskId - b.taskId,
  );
}

function taskIdsInClause(
  taskIds: number[],
): { clause: string; params: Record<string, number> } {
  const params: Record<string, number> = {};
  const parts = taskIds.map((id, i) => {
    const key = `taskId${i}`;
    params[key] = id;
    return `@${key}`;
  });
  return { clause: parts.join(", "), params };
}

export async function fetchTrackingSummaryRows(
  config: DbConfig,
  boardIds: number[],
  options: LoadTaskTrackingHoursOptions = {},
): Promise<TrackingSummaryRow[]> {
  if (boardIds.length === 0) return [];

  const scopedBoardIds =
    options.boardId != null ? boardIds.filter((id) => id === options.boardId) : boardIds;
  if (scopedBoardIds.length === 0) return [];

  const { clause: boardClause, params: boardParams } = boardIdsInClause(
    scopedBoardIds,
    "trackBoard",
  );

  let taskFilter = "";
  let taskParams: Record<string, number> = {};
  if (options.taskIds && options.taskIds.length > 0) {
    const { clause, params } = taskIdsInClause(options.taskIds);
    taskFilter = ` AND uts.task_id IN (${clause})`;
    taskParams = params;
  }

  return querySelect<TrackingSummaryRow>(
    config,
    `
SELECT
  uts.board_id,
  uts.task_id,
  uts.user_id,
  u.real_name AS user_name,
  uts.total_time,
  uts.append_total_time,
  uts.date,
  uts.removed
FROM dbo.UserTrackingSummaries uts
${TRACKING_HOURS_BOARD_TASK_JOIN}
LEFT JOIN dbo.Users u ON u.id = uts.user_id
WHERE uts.removed = 0
  AND uts.task_id IS NOT NULL
  AND uts.board_id IN (${boardClause})${taskFilter}
ORDER BY uts.board_id, uts.task_id, uts.user_id, uts.date
`,
    { ...boardParams, ...taskParams },
  );
}

export async function loadTaskTrackingHours(
  config: DbConfig,
  boardIds: number[],
  options: LoadTaskTrackingHoursOptions = {},
): Promise<TaskTrackingHours[]> {
  const rows = await fetchTrackingSummaryRows(config, boardIds, options);
  const scopeIds =
    options.boardId != null
      ? boardIds.filter((id) => id === options.boardId)
      : boardIds;
  return aggregateTrackingByTask(rows, scopeIds);
}

export async function fetchTaskTrackingMeta(
  config: DbConfig,
  boardId: number,
  taskIds: number[],
): Promise<TaskTrackingMeta[]> {
  if (taskIds.length === 0) return [];

  const { clause, params } = taskIdsInClause(taskIds);
  params.boardId = boardId;

  const tasks = await querySelect<{
    id: number;
    board_id: number;
    task_name: string | null;
    status_name: string | null;
  }>(
    config,
    `
SELECT
  t.id,
  t.board_id,
  t.name AS task_name,
  s.name AS status_name
FROM dbo.BoardTasks t
LEFT JOIN dbo.BoardStates s
  ON s.id = t.state_id AND s.board_id = t.board_id
WHERE t.board_id = @boardId AND t.id IN (${clause})
ORDER BY t.id
`,
    params,
  );

  const assignees = await querySelect<{
    task_id: number;
    real_name: string | null;
  }>(
    config,
    `
SELECT tu.task_id, u.real_name
FROM dbo.BoardTaskUsers tu
LEFT JOIN dbo.Users u ON u.id = tu.user_id
WHERE tu.board_id = @boardId AND tu.task_id IN (${clause})
`,
    params,
  );

  const assigneesByTask = new Map<number, string[]>();
  for (const a of assignees) {
    const name = a.real_name?.trim();
    if (!name) continue;
    const list = assigneesByTask.get(a.task_id) ?? [];
    list.push(name);
    assigneesByTask.set(a.task_id, list);
  }

  return tasks.map((t) => ({
    boardId: t.board_id,
    taskId: t.id,
    title: t.task_name,
    statusName: t.status_name,
    assigneeNames: assigneesByTask.get(t.id) ?? [],
  }));
}

export function sumRawTrackingParts(rows: TrackingSummaryRow[]): {
  rawTotalTimeMs: number;
  rawAppendTotalTimeMs: number;
} {
  let rawTotalTimeMs = 0;
  let rawAppendTotalTimeMs = 0;
  for (const row of rows) {
    rawTotalTimeMs += Number(row.total_time) || 0;
    rawAppendTotalTimeMs += Number(row.append_total_time) || 0;
  }
  return { rawTotalTimeMs, rawAppendTotalTimeMs };
}

export async function loadTaskTrackingProbeRows(
  config: DbConfig,
  boardId: number,
  taskIds: number[],
  appTaskBaseUrl: string,
): Promise<TaskTrackingProbeRow[]> {
  const boardIds = [boardId];
  const [hours, metaRows, rawRows] = await Promise.all([
    loadTaskTrackingHours(config, boardIds, { boardId, taskIds }),
    fetchTaskTrackingMeta(config, boardId, taskIds),
    fetchTrackingSummaryRows(config, boardIds, { boardId, taskIds }),
  ]);

  const metaByKey = new Map(
    metaRows.map((m) => [`${m.boardId}:${m.taskId}`, m] as const),
  );
  const rawByKey = new Map<string, TrackingSummaryRow[]>();
  for (const row of rawRows) {
    if (row.task_id == null) continue;
    const key = `${row.board_id}:${row.task_id}`;
    const list = rawByKey.get(key) ?? [];
    list.push(row);
    rawByKey.set(key, list);
  }

  const base = appTaskBaseUrl.replace(/\/$/, "");
  const orderedIds = [...new Set(taskIds)].sort((a, b) => a - b);

  return orderedIds.map((taskId) => {
    const key = `${boardId}:${taskId}`;
    const hoursRow = hours.find(
      (h) => h.boardId === boardId && h.taskId === taskId,
    );
    const meta = metaByKey.get(key);
    const raw = rawByKey.get(key) ?? [];
    const parts = sumRawTrackingParts(raw);

    return {
      boardId,
      taskId,
      title: meta?.title?.replace(/\s+/g, " ").trim() ?? null,
      statusName: meta?.statusName ?? null,
      assigneeNames: meta?.assigneeNames ?? [],
      totalMs: hoursRow?.actualMs ?? 0,
      totalHours: hoursRow?.actualHours ?? 0,
      actualMs: hoursRow?.actualMs ?? 0,
      actualHours: hoursRow?.actualHours ?? 0,
      manualAppendMs: hoursRow?.manualAppendMs ?? 0,
      manualAppendHours: hoursRow?.manualAppendHours ?? 0,
      usersCount: hoursRow?.usersCount ?? 0,
      trackingDaysCount: hoursRow?.trackingDaysCount ?? 0,
      firstTrackingDate: hoursRow?.firstTrackingDate ?? null,
      lastTrackingDate: hoursRow?.lastTrackingDate ?? null,
      perUser: hoursRow?.perUser ?? [],
      rawTotalTimeMs: parts.rawTotalTimeMs,
      rawAppendTotalTimeMs: parts.rawAppendTotalTimeMs,
      taskUrl: `${base}/board/${boardId}/${taskId}`,
    };
  });
}
