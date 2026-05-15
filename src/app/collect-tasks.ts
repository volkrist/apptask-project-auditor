import type { Page } from "@playwright/test";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../adapters/apptask/auth.js";
import { openBoardWithReadiness, BOARD_READY_TIMEOUT_MS } from "../adapters/apptask/board.js";
import { BOARD_SELECTORS } from "../adapters/apptask/selectors.js";
import {
  closeTaskCard,
  openTaskCard,
  parseTaskCard,
} from "../adapters/apptask/card.js";
import {
  collectTaskRefsFromBoard,
  expandAllCategories,
} from "../adapters/apptask/collect.js";
import { TASK_MODAL_SELECTORS } from "../adapters/apptask/selectors.js";
import { createLogger } from "../adapters/apptask/logger.js";
import type { RawTask } from "../adapters/apptask/types.js";
import { parseBoardId } from "../adapters/apptask/urls.js";

const log = createLogger("audit:collect");

/** Закрыть модалку и вернуть доску в состояние для следующего клика. */
async function restoreBoardView(page: Page, boardUrl: string): Promise<void> {
  const modal = page.locator(".modal.detailed-task");

  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await modal.isVisible().catch(() => false))) break;
    const closeBtn = page.locator(TASK_MODAL_SELECTORS.closeButton).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => undefined);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  if (await modal.isVisible().catch(() => false) || /\/board\/\d+\/\d+/.test(page.url())) {
    log.info("return to board list URL");
    await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  await modal.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  await page
    .locator(BOARD_SELECTORS.category)
    .first()
    .waitFor({ state: "attached", timeout: BOARD_READY_TIMEOUT_MS });
  await expandAllCategories(page);
}

export type CollectTasksOptions = {
  /** Ограничение числа карточек (для отладки). 0 = без лимита. */
  maxCards?: number;
  onProgress?: (current: number, total: number, title: string | null) => void;
};

async function collectTasksOnPage(
  page: Page,
  boardUrl: string,
  boardId: string,
  options: CollectTasksOptions,
): Promise<RawTask[]> {
  await openBoardWithReadiness(page, boardUrl);
  const refs = await collectTaskRefsFromBoard(page);

  if (refs.length === 0) {
    throw new Error("На доске не найдено карточек после раскрытия категорий");
  }

  const limit =
    options.maxCards && options.maxCards > 0
      ? Math.min(options.maxCards, refs.length)
      : refs.length;

  const tasks: RawTask[] = [];

  for (let i = 0; i < limit; i++) {
    const ref = refs[i]!;
    const title = ref.titlePreview ?? ref.taskId ?? "?";
    options.onProgress?.(i + 1, limit, ref.titlePreview);

    log.info(`[${i + 1}/${limit}] parse: ${title}`);
    await openTaskCard(page, ref, boardId);
    const task = await parseTaskCard(page, ref);
    await closeTaskCard(page);
    await restoreBoardView(page, boardUrl);
    tasks.push(task);
  }

  return tasks;
}

/** Сбор всех карточек с доски через существующий parser (без изменений adapter API). */
export async function collectTasksFromBoard(
  boardUrl: string,
  options: CollectTasksOptions = {},
): Promise<RawTask[]> {
  assertProfileExists();
  const boardId = parseBoardId(boardUrl);
  if (!boardId) throw new Error(`Некорректный URL доски: ${boardUrl}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    return await collectTasksOnPage(page, boardUrl, boardId, options);
  } finally {
    await context.close();
  }
}
