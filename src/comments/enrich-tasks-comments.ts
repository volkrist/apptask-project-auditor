import type { Page } from "@playwright/test";
import type { RawTask } from "../adapters/apptask/types.js";
import { createLogger } from "../adapters/apptask/logger.js";
import {
  appTaskCommentsToTaskComments,
  getCommentsReplayHeaders,
  loadTaskComments,
  mergeCommentsReplayHeaders,
} from "./app-task-comments.js";
import {
  type CommentsAuditConfig,
  filterTasksForCommentsLoad,
} from "./comments-audit-config.js";
import {
  type CommentsBoardContext,
  isTaskOnBoard,
} from "./comments-board-context.js";

const log = createLogger("comments:enrich");

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

export type EnrichCommentsResult = {
  boardUrl: string;
  boardId: string;
  mode: CommentsAuditConfig["mode"];
  commentsLimit: number | null;
  /** Задач-кандидатов по mode до применения commentsLimit. */
  candidates: number;
  checkedComments: number;
  tasksWithComments: number;
  durationMs: number;
};

/**
 * Заполняет task.comments через API (без открытия модалки).
 * При ошибке API для задачи — comments=[].
 */
export async function enrichTasksWithComments(
  page: Page,
  tasks: RawTask[],
  config: CommentsAuditConfig,
  board: CommentsBoardContext,
  options: { replayHeaders?: Record<string, string> } = {},
): Promise<EnrichCommentsResult> {
  const started = Date.now();
  const limitLabel =
    config.commentsLimit != null ? String(config.commentsLimit) : null;

  const empty: EnrichCommentsResult = {
    boardUrl: board.boardUrl,
    boardId: board.boardId,
    mode: config.mode,
    commentsLimit: limitLabel != null ? config.commentsLimit! : null,
    candidates: 0,
    checkedComments: 0,
    tasksWithComments: 0,
    durationMs: 0,
  };

  if (config.mode === "off") {
    return empty;
  }

  log.info(
    `Comments audit: boardUrl=${board.boardUrl}, boardId=${board.boardId}, mode=${config.mode}, comments_limit=${limitLabel ?? "none"}`,
  );

  const onBoard = tasks.filter((t) => isTaskOnBoard(t, board.boardId));
  const skipped = tasks.length - onBoard.length;
  if (skipped > 0) {
    log.info(
      `Comments audit: skipped ${skipped} task(s) not matching boardId=${board.boardId}`,
    );
  }

  const candidates = filterTasksForCommentsLoad(onBoard, {
    mode: config.mode,
  });
  empty.candidates = candidates.length;

  const targets = filterTasksForCommentsLoad(onBoard, config);

  if (targets.length === 0) {
    empty.durationMs = Date.now() - started;
    log.info(
      `Comments audit: boardId=${board.boardId}, checked=0, withComments=0`,
    );
    return empty;
  }

  let withComments = 0;

  const replayHeaders = mergeCommentsReplayHeaders(
    options.replayHeaders,
    getCommentsReplayHeaders(),
  );

  await runPool(targets, config.concurrency, async (task) => {
    const taskId = task.id!;
    const apiComments = await loadTaskComments(page, taskId, board.boardIdNum, {
      replayHeaders,
    });
    const mapped = appTaskCommentsToTaskComments(apiComments);
    task.comments = mapped;
    if (mapped.length > 0) withComments++;
  });

  const durationMs = Date.now() - started;
  const durationSec = Math.round(durationMs / 1000);

  log.info(
    `Comments audit: boardUrl=${board.boardUrl}, boardId=${board.boardId}, mode=${config.mode}, limit=${limitLabel ?? "none"}, checked=${targets.length}, withComments=${withComments}, duration=${durationSec}s`,
  );

  return {
    boardUrl: board.boardUrl,
    boardId: board.boardId,
    mode: config.mode,
    commentsLimit: limitLabel != null ? config.commentsLimit! : null,
    candidates: empty.candidates,
    checkedComments: targets.length,
    tasksWithComments: withComments,
    durationMs,
  };
}
