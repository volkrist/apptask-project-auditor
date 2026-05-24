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
import { attachCommentsApiDiscovery } from "../comments/app-task-comments.js";
import {
  loadCommentsAuditConfig,
  type CommentsAuditMode,
} from "../comments/comments-audit-config.js";
import { enrichTasksWithComments } from "../comments/enrich-tasks-comments.js";
import {
  loadAppTaskUsers,
  type AppTaskUser,
} from "../users/app-task-users.js";
import { loadCollectorConfig } from "../collectors/collector-config.js";
import { collectTasksViaApi } from "../collectors/api-collector.js";

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
  /** Переопределяет COMMENTS_AUDIT_MODE из env. */
  commentsAuditMode?: CommentsAuditMode;
};

export type CollectTasksResult = {
  tasks: RawTask[];
  totalOnBoard: number;
  appTaskUsers: AppTaskUser[];
};

async function collectTasksPlaywrightOnPage(
  page: Page,
  boardUrl: string,
  boardId: string,
  options: CollectTasksOptions,
  appTaskUsers: AppTaskUser[],
): Promise<CollectTasksResult> {
  const commentsConfig = loadCommentsAuditConfig(
    options.commentsAuditMode
      ? { mode: options.commentsAuditMode }
      : {},
  );
  const stopApiDiscovery =
    commentsConfig.mode !== "off"
      ? attachCommentsApiDiscovery(page)
      : () => undefined;

  await openBoardWithReadiness(page, boardUrl);
  const refs = await collectTaskRefsFromBoard(page);

  if (refs.length === 0) {
    throw new Error("На доске не найдено карточек после раскрытия категорий");
  }

  const totalOnBoard = refs.length;
  const taskIdFilter = process.env.AUDIT_TASK_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let refsToProcess = refs;
  if (taskIdFilter?.length) {
    refsToProcess = refs.filter(
      (r) => r.taskId && taskIdFilter.includes(r.taskId),
    );
  }
  if (options.maxCards && options.maxCards > 0) {
    refsToProcess = refsToProcess.slice(0, options.maxCards);
  }

  const tasks: RawTask[] = [];

  for (let i = 0; i < refsToProcess.length; i++) {
    const ref = refsToProcess[i]!;
    const title = ref.titlePreview ?? ref.taskId ?? "?";
    options.onProgress?.(i + 1, refsToProcess.length, ref.titlePreview);

    log.info(`[${i + 1}/${refsToProcess.length}] parse: ${title}`);
    await openTaskCard(page, ref, boardId);
    const task = await parseTaskCard(page, ref);
    await closeTaskCard(page);
    await restoreBoardView(page, boardUrl);
    tasks.push(task);
  }

  stopApiDiscovery();
  const boardIdNum = Number(boardId);
  await enrichTasksWithComments(
    page,
    tasks,
    commentsConfig,
    Number.isFinite(boardIdNum) ? boardIdNum : undefined,
  );

  return { tasks, totalOnBoard, appTaskUsers };
}

async function collectTasksPlaywright(
  boardUrl: string,
  options: CollectTasksOptions,
): Promise<CollectTasksResult> {
  assertProfileExists();
  const boardId = parseBoardId(boardUrl);
  if (!boardId) throw new Error(`Некорректный URL доски: ${boardUrl}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    log.info("load AppTask users (get_users)");
    const appTaskUsers = await loadAppTaskUsers(page);
    log.info(`AppTask users loaded: ${appTaskUsers.length}`);
    return await collectTasksPlaywrightOnPage(
      page,
      boardUrl,
      boardId,
      options,
      appTaskUsers,
    );
  } finally {
    await context.close();
  }
}

/** Сбор карточек: APPTASK_COLLECTOR=api|playwright (по умолчанию playwright). */
export async function collectTasksFromBoard(
  boardUrl: string,
  options: CollectTasksOptions = {},
): Promise<CollectTasksResult> {
  const collectorCfg = loadCollectorConfig();
  if (collectorCfg.collector !== "api") {
    return collectTasksPlaywright(boardUrl, options);
  }

  log.info("collector mode: api");
  try {
    return await collectTasksViaApi(boardUrl, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.info(`API collector critical error: ${message}`);
    if (!collectorCfg.apiFallbackToPlaywright) {
      throw new Error(`API collector failed: ${message}`);
    }
    log.info("fallback to playwright collector");
    return collectTasksPlaywright(boardUrl, options);
  }
}
