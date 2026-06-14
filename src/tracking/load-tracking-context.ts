import { loadDbConfig } from "../collectors/db-config.js";
import { closeDb } from "../collectors/db-client.js";
import {
  aggregateTrackingByTask,
  fetchTrackingSummaryRows,
  taskTrackingKey,
  type TaskTrackingHours,
} from "./tracking-hours-reader.js";
import {
  loadTrackingHoursConfig,
  type TrackingHoursConfig,
} from "./tracking-hours-config.js";

export type TrackingAuditContext = {
  config: TrackingHoursConfig;
  loaded: boolean;
  loadError?: string;
  byTaskKey: Record<string, TaskTrackingHours>;
  rowCount: number;
};

function buildIndex(rows: TaskTrackingHours[]): Record<string, TaskTrackingHours> {
  const byTaskKey: Record<string, TaskTrackingHours> = {};
  for (const row of rows) {
    byTaskKey[taskTrackingKey(row.boardId, row.taskId)] = row;
  }
  return byTaskKey;
}

export async function loadTrackingAuditContext(
  boardIds: number[],
): Promise<TrackingAuditContext> {
  const config = loadTrackingHoursConfig();
  const empty: TrackingAuditContext = {
    config,
    loaded: false,
    byTaskKey: {},
    rowCount: 0,
  };

  if (boardIds.length === 0) {
    return { ...empty, loadError: "нет board ids для tracking" };
  }

  try {
    const dbConfig = loadDbConfig({ boardIds });
    const rawRows = await fetchTrackingSummaryRows(dbConfig, boardIds);
    const aggregated = aggregateTrackingByTask(rawRows, boardIds);
    await closeDb();
    return {
      config,
      loaded: true,
      byTaskKey: buildIndex(aggregated),
      rowCount: rawRows.length,
    };
  } catch (err) {
    await closeDb().catch(() => undefined);
    return {
      ...empty,
      loadError: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getTaskTrackingMetrics(
  ctx: TrackingAuditContext | null | undefined,
  task: { boardId?: string | null; id?: string | null },
): TaskTrackingHours | null {
  if (!ctx?.loaded || !task.boardId || !task.id) return null;
  return ctx.byTaskKey[taskTrackingKey(task.boardId, task.id)] ?? null;
}
