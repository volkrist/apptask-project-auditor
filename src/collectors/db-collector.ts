import { parseBoardId } from "../adapters/apptask/urls.js";
import { createLogger } from "../adapters/apptask/logger.js";
import type { RawTask } from "../adapters/apptask/types.js";
import type { CollectTasksOptions, CollectTasksResult } from "../app/collect-tasks.js";
import { filterTasksByIgnored } from "../audit-ignore/ignored-tasks.js";
import {
  countTasksByBoard,
  limitTasksMultiBoard,
  loadAuditScope,
} from "../config/audit-scope.js";
import { loadDbConfig, parseBoardIds } from "./db-config.js";
import { closeDb } from "./db-client.js";
import {
  fetchActiveTasks,
  fetchAssignees,
  fetchComments,
  fetchHistories,
  fetchBoardStates,
  fetchTags,
} from "./db-queries.js";
import { mapDbBundleToRawTasks } from "./db-mapper.js";
import { buildStateNameByKey } from "./state-map.js";

const log = createLogger("collector:db");

export type DbCollectorStats = {
  source: "db";
  boardIds: number[];
  auditScope: "single" | "multi";
  maxCardsScope: "total";
  tasksLoaded: number;
  availableByBoard: Record<string, number>;
  auditedByBoard: Record<string, number>;
  assigneeRows: number;
  tagRows: number;
  commentRows: number;
  historyRows: number;
  stateNameByKey: Record<string, string>;
};

export async function collectTasksViaDb(
  boardUrl: string,
  options: CollectTasksOptions = {},
): Promise<CollectTasksResult & { stats: DbCollectorStats }> {
  const boardIdFromUrl = parseBoardId(boardUrl);
  const config = loadDbConfig();
  const auditScope = loadAuditScope();
  let boardIds = config.boardIds;

  if (boardIdFromUrl) {
    const id = Number(boardIdFromUrl);
    if (Number.isFinite(id) && id > 0 && !boardIds.includes(id)) {
      boardIds = [id, ...boardIds];
    }
  }
  if (boardIds.length === 0 && boardIdFromUrl) {
    boardIds = [Number(boardIdFromUrl)];
  }
  if (boardIds.length === 0) {
    throw new Error(
      "DB collector: укажите APPTASK_DB_BOARD_IDS или URL доски с board_id",
    );
  }

  log.info(`collect via DB boardIds=${boardIds.join(",")} auditScope=${auditScope}`);

  try {
    const [tasks, assignees, tags, comments, histories, boardStates] =
      await Promise.all([
      fetchActiveTasks(config, boardIds),
      fetchAssignees(config, boardIds),
      fetchTags(config, boardIds),
      fetchComments(config, boardIds),
      fetchHistories(config, boardIds),
      fetchBoardStates(config, boardIds),
    ]);

    const stateNameByKey = buildStateNameByKey(boardStates);

    let rawTasks = mapDbBundleToRawTasks(
      { tasks, assignees, tags, comments, histories },
      config.appTaskBaseUrl,
    );

    const tasksByBoard = new Map<string, number>();
    for (const t of rawTasks) {
      const bid = t.boardId ?? "?";
      tasksByBoard.set(bid, (tasksByBoard.get(bid) ?? 0) + 1);
    }
    log.info(
      `DB tasks loaded by board: ${[...tasksByBoard.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, n]) => `${id}=${n}`)
        .join(", ")}`,
    );
    log.info(
      `DB rows: comments=${comments.length} history=${histories.length} assignees=${assignees.length} tags=${tags.length}`,
    );

    if (auditScope === "single" && boardIdFromUrl) {
      rawTasks = rawTasks.filter((t) => t.boardId === boardIdFromUrl);
      log.info(
        `auditScope=single: filtered to board ${boardIdFromUrl}: ${rawTasks.length} tasks`,
      );
    } else if (auditScope === "multi") {
      log.info(
        `auditScope=multi: auditing all configured boards (${boardIds.join(",")}), ${rawTasks.length} tasks before limit`,
      );
    }

    const availableByBoard = countTasksByBoard(rawTasks);
    const totalOnBoard = rawTasks.length;

    const taskIdFilter = process.env.AUDIT_TASK_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (taskIdFilter?.length) {
      rawTasks = rawTasks.filter(
        (t) => t.id && taskIdFilter.includes(t.id),
      );
    }

    const ignored = filterTasksByIgnored(rawTasks, boardUrl);
    rawTasks = ignored.tasks;

    if (options.maxCards && options.maxCards > 0) {
      if (auditScope === "multi" && boardIds.length > 1) {
        rawTasks = limitTasksMultiBoard(rawTasks, boardIds, options.maxCards);
        log.info(
          `maxCardsScope=total (round-robin): limited to ${options.maxCards} tasks across boards`,
        );
      } else {
        rawTasks = rawTasks.slice(0, options.maxCards);
        log.info(`limited to maxCards=${options.maxCards}: auditing ${rawTasks.length} tasks`);
      }
    }

    const auditedByBoard = countTasksByBoard(rawTasks);
    if (Object.keys(auditedByBoard).length > 0) {
      log.info(
        `tasks audited by board: ${Object.entries(auditedByBoard)
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([id, n]) => `${id}=${n}`)
          .join(", ")}`,
      );
    }

    let cur = 0;
    for (const t of rawTasks) {
      cur++;
      options.onProgress?.(cur, rawTasks.length, t.title);
    }

    const stats: DbCollectorStats = {
      source: "db",
      boardIds,
      auditScope,
      maxCardsScope: "total",
      tasksLoaded: rawTasks.length,
      availableByBoard,
      auditedByBoard,
      assigneeRows: assignees.length,
      tagRows: tags.length,
      commentRows: comments.length,
      historyRows: histories.length,
      stateNameByKey,
    };

    log.info(
      `DB collect done: tasks=${stats.tasksLoaded} comments=${stats.commentRows} history=${stats.historyRows}`,
    );

    return {
      tasks: rawTasks,
      totalOnBoard,
      appTaskUsers: [],
      ignoredCount: ignored.skippedCount,
      ignoredUrls: ignored.skippedUrls,
      stats,
    };
  } finally {
    await closeDb();
  }
}

/** Resolve board ids for CLI probes (--board-ids overrides env). */
export function resolveProbeBoardIds(argvBoardIds: number[]): number[] {
  if (argvBoardIds.length > 0) return argvBoardIds;
  return parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);
}
