import type { Page } from "@playwright/test";
import { openBoardWithReadiness } from "../adapters/apptask/board.js";
import { collectTaskRefsFromBoard } from "../adapters/apptask/collect.js";
import { createLogger } from "../adapters/apptask/logger.js";
import { emptyRawTask, type RawTask } from "../adapters/apptask/types.js";
import { parseBoardId } from "../adapters/apptask/urls.js";

const log = createLogger("comments:collect");

/** Минимальные RawTask с доски только для загрузки комментариев (без parse карточек). */
export async function collectRawTasksForCommentsBoard(
  page: Page,
  boardUrl: string,
): Promise<RawTask[]> {
  const boardId = parseBoardId(boardUrl);
  if (!boardId) {
    throw new Error(`Некорректный URL доски для комментариев: ${boardUrl}`);
  }

  await openBoardWithReadiness(page, boardUrl);
  const refs = await collectTaskRefsFromBoard(page);
  const base = boardUrl.replace(/\/$/, "");

  const tasks = refs
    .filter((r) => r.taskId)
    .map((ref) => {
      const t = emptyRawTask();
      t.id = ref.taskId;
      t.url = `${base}/${ref.taskId}`;
      t.title = ref.titlePreview;
      t.category = ref.categoryName;
      return t;
    });

  log.info(
    `Comments board collect: boardUrl=${boardUrl}, refs=${refs.length}, withTaskId=${tasks.length}`,
  );
  return tasks;
}
