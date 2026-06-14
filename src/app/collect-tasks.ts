import type { Page } from "@playwright/test";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../adapters/apptask/auth.js";
import { openBoardWithReadiness, BOARD_READY_TIMEOUT_MS } from "../adapters/apptask/board.js";
import { BOARD_SELECTORS } from "../adapters/apptask/selectors.js";
import {
  buildPartialRawTask,
  closeTaskCard,
  openTaskCard,
  ParseTaskCardError,
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
import {
  attachCommentsApiDiscovery,
  getCommentsReplayHeaders,
  mergeCommentsReplayHeaders,
} from "../comments/app-task-comments.js";
import { attachBoardApiSniffer } from "../collectors/board-api-sniffer.js";
import {
  loadCommentsAuditConfig,
  type CommentsAuditMode,
} from "../comments/comments-audit-config.js";
import {
  enrichTasksWithComments,
  type EnrichCommentsResult,
} from "../comments/enrich-tasks-comments.js";
import { collectRawTasksForCommentsBoard } from "../comments/comments-board-collect.js";
import {
  isSameCommentsBoard,
  resolveCommentsBoardContext,
  resolveCommentsBoardUrl,
} from "../comments/comments-board-context.js";
import {
  loadAppTaskUsers,
  type AppTaskUser,
} from "../users/app-task-users.js";
import { loadCollectorConfig } from "../collectors/collector-config.js";
import { collectTasksViaApi } from "../collectors/api-collector.js";
import { collectTasksViaDb, type DbCollectorStats } from "../collectors/db-collector.js";
import { filterTaskRefsByIgnored } from "../audit-ignore/ignored-tasks.js";

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
    log.info(`[card] returned to board boardUrl=${boardUrl}`);
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
  /** Лимит только для загрузки комментариев (не maxCards). */
  commentsAuditLimit?: number;
  /** Отдельная доска для comments audit; если не задана — board_url. */
  commentsBoardUrl?: string;
};

export type CollectTasksResult = {
  tasks: RawTask[];
  totalOnBoard: number;
  appTaskUsers: AppTaskUser[];
  commentsAudit?: EnrichCommentsResult;
  ignoredCount: number;
  ignoredUrls: string[];
  /** Заполняется DB collector — scope, лимиты, разбивка по доскам. */
  dbStats?: DbCollectorStats;
};

async function collectTasksPlaywrightOnPage(
  page: Page,
  boardUrl: string,
  boardId: string,
  options: CollectTasksOptions,
  appTaskUsers: AppTaskUser[],
): Promise<CollectTasksResult> {
  const commentsConfig = loadCommentsAuditConfig({
    mode: options.commentsAuditMode ?? "off",
    ...(options.commentsAuditLimit != null
      ? { commentsLimit: options.commentsAuditLimit }
      : {}),
  });
  const sniffer = attachBoardApiSniffer(page);
  const stopCommentsDiscovery =
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
  const ignored = filterTaskRefsByIgnored(refsToProcess, boardUrl);
  refsToProcess = ignored.refs;
  if (options.maxCards && options.maxCards > 0) {
    refsToProcess = refsToProcess.slice(0, options.maxCards);
  }

  log.info(
    `board refs=${totalOnBoard}, will audit=${refsToProcess.length}${
      options.maxCards && options.maxCards > 0
        ? ` (card limit=${options.maxCards})`
        : " (no card limit)"
    }`,
  );

  const tasks: RawTask[] = [];

  for (let i = 0; i < refsToProcess.length; i++) {
    const ref = refsToProcess[i]!;
    const title = ref.titlePreview ?? ref.taskId ?? "?";
    options.onProgress?.(i + 1, refsToProcess.length, ref.titlePreview);

    log.info(`[${i + 1}/${refsToProcess.length}] parse: ${title}`);
    try {
      const openResult = await openTaskCard(page, ref, boardUrl, boardId);
      if (!openResult.ok) {
        log.info(`[card] parse failed taskId=${ref.taskId ?? "?"}, using partial task`);
        tasks.push(buildPartialRawTask(ref, boardUrl));
        await closeTaskCard(page).catch(() => undefined);
        await restoreBoardView(page, boardUrl).catch(() => undefined);
        continue;
      }

      const task = await parseTaskCard(page, ref);
      await closeTaskCard(page);
      await restoreBoardView(page, boardUrl);
      tasks.push(task);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const recoverable =
        err instanceof ParseTaskCardError ||
        /task card UI not ready|Timeout.*exceeded/i.test(message);
      if (recoverable) {
        log.info(`[card] parse failed taskId=${ref.taskId ?? "?"}, using partial task: ${message}`);
        tasks.push(buildPartialRawTask(ref, boardUrl));
        await closeTaskCard(page).catch(() => undefined);
        await restoreBoardView(page, boardUrl).catch(() => undefined);
        continue;
      }
      await closeTaskCard(page).catch(() => undefined);
      await restoreBoardView(page, boardUrl).catch(() => undefined);
      throw err;
    }
  }

  stopCommentsDiscovery();
  const commentsReplayHeaders = mergeCommentsReplayHeaders(
    sniffer.apiRequestHeaders,
    getCommentsReplayHeaders(),
  );
  if (!page.url().includes(`/board/${boardId}`) || /\/board\/\d+\/\d+/.test(page.url())) {
    await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(
      () => undefined,
    );
  }
  let commentsAudit: EnrichCommentsResult | undefined;
  if (commentsConfig.mode !== "off") {
    const commentsBoardUrl = resolveCommentsBoardUrl(
      boardUrl,
      options.commentsBoardUrl,
    );
    log.info(`Comments audit boardUrl=${commentsBoardUrl}`);
    const commentsBoard = resolveCommentsBoardContext(commentsBoardUrl);
    if (!commentsBoard) {
      log.info(`Comments audit skipped: invalid boardUrl=${commentsBoardUrl}`);
    } else {
      const useMainTasks = isSameCommentsBoard(boardUrl, commentsBoardUrl);
      const tasksForComments = useMainTasks
        ? tasks
        : await collectRawTasksForCommentsBoard(page, commentsBoardUrl);
      if (!useMainTasks) {
        log.info(
          `Comments audit: separate board, ${tasksForComments.length} task(s) for comment load`,
        );
      }
      commentsAudit = await enrichTasksWithComments(
        page,
        tasksForComments,
        commentsConfig,
        commentsBoard,
        { replayHeaders: commentsReplayHeaders },
      );
    }
  }

  sniffer.stop();
  return {
    tasks,
    totalOnBoard,
    appTaskUsers,
    commentsAudit,
    ignoredCount: ignored.skippedCount,
    ignoredUrls: ignored.skippedUrls,
  };
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

/** Сбор карточек: APPTASK_COLLECTOR=playwright|api|db (по умолчанию playwright). */
export async function collectTasksFromBoard(
  boardUrl: string,
  options: CollectTasksOptions = {},
): Promise<CollectTasksResult> {
  const collectorCfg = loadCollectorConfig();

  if (collectorCfg.collector === "db") {
    log.info("collector mode: db");
    try {
      const { stats, ...rest } = await collectTasksViaDb(boardUrl, options);
      return { ...rest, dbStats: stats };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.info(`DB collector critical error: ${message}`);
      if (!collectorCfg.dbFallbackToPlaywright) {
        throw new Error(`DB collector failed: ${message}`);
      }
      log.info("fallback to playwright collector");
      return collectTasksPlaywright(boardUrl, options);
    }
  }

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
