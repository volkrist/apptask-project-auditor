import type { Page } from "@playwright/test";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../adapters/apptask/board.js";
import { collectTaskRefsFromBoard } from "../adapters/apptask/collect.js";
import { createLogger } from "../adapters/apptask/logger.js";
import { parseBoardId } from "../adapters/apptask/urls.js";
import {
  isAuditLocked,
  releaseAuditLock,
  tryAcquireAuditLock,
} from "./audit-lock.js";
import {
  attachCommentsApiDiscovery,
  getCommentsReplayHeaders,
  loadTaskComments,
  mergeCommentsReplayHeaders,
} from "../comments/app-task-comments.js";
import {
  attachApiBaseDiscovery,
} from "../collectors/app-task-api-client.js";
import { attachBoardApiSniffer } from "../collectors/board-api-sniffer.js";
import {
  findMarkerHitsInComments,
  type CommentMarkerHit,
} from "../comments/comment-markers.js";
import { resolveCommentsBoardContext } from "../comments/comments-board-context.js";
import { writeCommentsReport } from "../comments/write-comments-report.js";

const log = createLogger("comments:command");

const DEFAULT_CONCURRENCY = 3;

export type RunCommentsCheckOptions = {
  /** 1..500 — только первые N задач с доски */
  limit?: number;
};

export type RunCommentsCheckResult = {
  boardUrl: string;
  mode: "full" | "limit";
  limit: number | null;
  totalTasksOnBoard: number;
  checkedTasks: number;
  tasksWithComments: number;
  totalComments: number;
  markerHits: CommentMarkerHit[];
  durationMs: number;
  output: {
    dir: string;
    summaryPath: string;
    detailedPath: string;
    jsonPath: string;
  };
};

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  async function runWorker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
}

function refsToMinimalTasks(
  boardUrl: string,
  refs: Awaited<ReturnType<typeof collectTaskRefsFromBoard>>,
): Array<{ id: string; url: string; title: string | null }> {
  const base = boardUrl.replace(/\/$/, "");
  return refs
    .filter((r) => r.taskId)
    .map((r) => ({
      id: r.taskId!,
      url: `${base}/${r.taskId}`,
      title: r.titlePreview,
    }));
}

async function runCommentsCheckOnPage(
  page: Page,
  boardUrl: string,
  options: RunCommentsCheckOptions,
): Promise<RunCommentsCheckResult> {
  const started = Date.now();
  const board = resolveCommentsBoardContext(boardUrl);
  if (!board) {
    throw new Error(`Некорректный URL доски: ${boardUrl}`);
  }

  const limitOpt =
    options.limit != null && options.limit > 0
      ? Math.min(500, Math.floor(options.limit))
      : undefined;

  log.info(
    `[comments-command] boardUrl=${boardUrl} limit=${limitOpt ?? "full"}`,
  );

  const stopApiDiscovery = attachApiBaseDiscovery(page);
  const sniffer = attachBoardApiSniffer(page);
  const stopCommentsDiscovery = attachCommentsApiDiscovery(page);
  await openBoardWithReadiness(page, boardUrl);
  stopCommentsDiscovery();
  const replayHeaders = mergeCommentsReplayHeaders(
    sniffer.apiRequestHeaders,
    getCommentsReplayHeaders(),
  );
  if (Object.keys(replayHeaders).length === 0) {
    log.info("[comments-command] warning: no replay headers from board API sniffer");
  } else {
    log.info(
      `[comments-command] replay headers: ${Object.keys(replayHeaders).join(", ")}`,
    );
  }
  const refs = await collectTaskRefsFromBoard(page);
  log.info(`[comments-command] collected task refs=${refs.length}`);

  let targets = refsToMinimalTasks(boardUrl, refs);
  const totalTasksOnBoard = targets.length;
  if (limitOpt != null) {
    targets = targets.slice(0, limitOpt);
  }

  let tasksWithComments = 0;
  let totalComments = 0;
  const markerHits: CommentMarkerHit[] = [];
  const taskRows: Array<{
    taskId: string;
    taskUrl: string;
    title: string | null;
    commentsCount: number;
  }> = [];

  const concurrency = Number(process.env.COMMENTS_AUDIT_CONCURRENCY ?? DEFAULT_CONCURRENCY);

  await runPool(targets, concurrency, async (task) => {
    const comments = await loadTaskComments(page, task.id, board.boardIdNum, {
      replayHeaders,
    });
    const count = comments.length;
    if (count > 0) tasksWithComments++;
    totalComments += count;
    taskRows.push({
      taskId: task.id,
      taskUrl: task.url,
      title: task.title,
      commentsCount: count,
    });
    markerHits.push(
      ...findMarkerHitsInComments(
        task.id,
        task.url,
        task.title,
        comments,
      ),
    );
  });

  stopApiDiscovery();
  sniffer.stop();

  const durationMs = Date.now() - started;
  const durationSec = Math.max(0, Math.round(durationMs / 1000));

  log.info(
    `[comments-command] checked=${targets.length} withComments=${tasksWithComments} totalComments=${totalComments} markersFound=${markerHits.length} duration=${durationSec}s`,
  );

  const output = writeCommentsReport({
    boardUrl,
    mode: limitOpt != null ? "limit" : "full",
    limit: limitOpt ?? null,
    totalTasksOnBoard,
    checkedTasks: targets.length,
    tasksWithComments,
    totalComments,
    markerHits,
    tasks: taskRows,
    durationMs,
  });

  return {
    boardUrl,
    mode: limitOpt != null ? "limit" : "full",
    limit: limitOpt ?? null,
    totalTasksOnBoard,
    checkedTasks: targets.length,
    tasksWithComments,
    totalComments,
    markerHits,
    durationMs,
    output,
  };
}

/**
 * Проверка комментариев на доске (без rule engine и без parse карточек).
 * boardUrl обязателен — .env не используется.
 */
export async function runCommentsCheck(
  boardUrl: string,
  options: RunCommentsCheckOptions = {},
): Promise<RunCommentsCheckResult> {
  if (!boardUrl.trim()) {
    throw new Error("board_url обязателен для /comments");
  }
  if (!parseBoardId(boardUrl)) {
    throw new Error(`Некорректный URL доски: ${boardUrl}`);
  }

  if (isAuditLocked()) {
    throw new Error("Аудит уже выполняется, дождитесь завершения.");
  }
  if (!tryAcquireAuditLock()) {
    throw new Error("Аудит уже выполняется, дождитесь завершения.");
  }

  assertProfileExists();
  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    return await runCommentsCheckOnPage(page, boardUrl, options);
  } finally {
    await context.close();
    releaseAuditLock();
  }
}

/** Для тестов: не открывает браузер. */
export function buildCommentsCheckTaskList(
  boardUrl: string,
  refs: Awaited<ReturnType<typeof collectTaskRefsFromBoard>>,
  limit?: number,
): Array<{ id: string; url: string; title: string | null }> {
  let list = refsToMinimalTasks(boardUrl, refs);
  if (limit != null && limit > 0) list = list.slice(0, limit);
  return list;
}

