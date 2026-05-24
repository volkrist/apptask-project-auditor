import type { Page } from "@playwright/test";
import type { RawTask } from "../adapters/apptask/types.js";
import { createLogger } from "../adapters/apptask/logger.js";
import { appTaskCommentsToTaskComments, loadTaskComments } from "./app-task-comments.js";
import {
  type CommentsAuditConfig,
  filterTasksForCommentsLoad,
} from "./comments-audit-config.js";

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
  mode: CommentsAuditConfig["mode"];
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
  boardId?: number,
): Promise<EnrichCommentsResult> {
  const started = Date.now();
  const empty: EnrichCommentsResult = {
    mode: config.mode,
    candidates: 0,
    checkedComments: 0,
    tasksWithComments: 0,
    durationMs: 0,
  };

  if (config.mode === "off") return empty;

  const targets = filterTasksForCommentsLoad(tasks, config.mode);
  empty.candidates = targets.length;

  if (targets.length === 0) {
    empty.durationMs = Date.now() - started;
    return empty;
  }

  let withComments = 0;

  await runPool(targets, config.concurrency, async (task) => {
    const taskId = task.id!;
    const apiComments = await loadTaskComments(page, taskId, boardId);
    const mapped = appTaskCommentsToTaskComments(apiComments);
    task.comments = mapped;
    if (mapped.length > 0) withComments++;
  });

  const durationMs = Date.now() - started;
  const durationSec = Math.round(durationMs / 1000);

  log.info(
    `Comments audit: mode=${config.mode}, checked=${targets.length}, withComments=${withComments}, duration=${durationSec}s`,
  );

  return {
    mode: config.mode,
    candidates: targets.length,
    checkedComments: targets.length,
    tasksWithComments: withComments,
    durationMs,
  };
}
