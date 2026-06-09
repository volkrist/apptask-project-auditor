import type { Page } from "@playwright/test";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../adapters/apptask/board.js";
import { expandAllCategories } from "../adapters/apptask/collect.js";
import { BOARD_SELECTORS } from "../adapters/apptask/selectors.js";
import { createLogger } from "../adapters/apptask/logger.js";
import type { RawTask } from "../adapters/apptask/types.js";
import { parseBoardId } from "../adapters/apptask/urls.js";
import { attachCommentsApiDiscovery } from "../comments/app-task-comments.js";
import {
  loadCommentsAuditConfig,
  type CommentsAuditMode,
} from "../comments/comments-audit-config.js";
import { enrichTasksWithComments } from "../comments/enrich-tasks-comments.js";
import type { AppTaskUser } from "../users/app-task-users.js";
import type { CollectTasksOptions, CollectTasksResult } from "../app/collect-tasks.js";
import {
  attachApiBaseDiscovery,
  getBoardBlocks,
  getBoardSprints,
  getBoardStates,
  getBoardTasks,
  getTaskDetails,
  getUsersViaApi,
  type ApiTaskListItem,
} from "./app-task-api-client.js";
import {
  attachBoardApiSniffer,
  waitForSnifferTasks,
} from "./board-api-sniffer.js";
import { collectRawTasksForCommentsBoard } from "../comments/comments-board-collect.js";
import {
  isSameCommentsBoard,
  resolveCommentsBoardContext,
  resolveCommentsBoardUrl,
} from "../comments/comments-board-context.js";
import { loadCollectorConfig } from "./collector-config.js";
import { filterTasksByIgnored } from "../audit-ignore/ignored-tasks.js";
import { filterTasksForDetailsLoad } from "./api-details-config.js";
import {
  buildBlocksMap,
  buildStatesMap,
  buildUsersMap,
  mapApiTaskListItemToRawTask,
  mergeTaskDetailsIntoRawTask,
} from "./api-mapper.js";

const log = createLogger("api-collector");

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

function resolveSprintId(
  sprints: Array<{ id: number; name: string; isPerformed?: boolean }>,
  warnings: string[],
): number | null {
  const envRaw = process.env.APPTASK_SPRINT_ID?.trim();
  if (envRaw) {
    const n = Number(envRaw);
    if (Number.isFinite(n)) return n;
  }
  if (sprints.length === 0) {
    warnings.push("sprintId: get_sprints returned empty list");
    return null;
  }
  const active = sprints.find((s) => s.isPerformed === false) ?? sprints[0]!;
  if (sprints.length > 1) {
    warnings.push(
      `sprintId: using sprint ${active.id} (${active.name}), ${sprints.length} sprints on board`,
    );
  }
  return active.id;
}

export type ApiCollectorStats = {
  boardUrl: string;
  boardId: number;
  sprintId: number | null;
  statesCount: number;
  statesMs: number;
  blocksCount: number;
  blocksMs: number;
  getTasksRequests: number;
  getTasksMs: number;
  tasksCollected: number;
  detailsLoaded: number;
  detailsMs: number;
  commentsLoaded: number;
  commentsMs: number;
  usersCount: number;
  usersMs: number;
  totalMs: number;
  warnings: string[];
};

export async function collectTasksViaApiOnPage(
  page: Page,
  boardUrl: string,
  options: CollectTasksOptions,
  appTaskUsers: AppTaskUser[],
): Promise<CollectTasksResult & { stats: ApiCollectorStats }> {
  const totalStarted = Date.now();
  const warnings: string[] = [];
  const collectorCfg = loadCollectorConfig();
  const commentsConfig = loadCommentsAuditConfig({
    ...(options.commentsAuditMode ? { mode: options.commentsAuditMode } : {}),
    ...(options.commentsAuditLimit != null
      ? { commentsLimit: options.commentsAuditLimit }
      : {}),
  });

  const boardIdStr = parseBoardId(boardUrl);
  if (!boardIdStr) throw new Error(`Некорректный URL доски: ${boardUrl}`);
  const boardId = Number(boardIdStr);
  if (!Number.isFinite(boardId)) {
    throw new Error(`Некорректный boardId: ${boardIdStr}`);
  }

  const stopApiDiscovery = attachApiBaseDiscovery(page);
  const sniffer = attachBoardApiSniffer(page);
  const stopCommentsDiscovery =
    commentsConfig.mode !== "off"
      ? attachCommentsApiDiscovery(page)
      : () => undefined;

  await openBoardWithReadiness(page, boardUrl);
  await page
    .locator(BOARD_SELECTORS.category)
    .first()
    .waitFor({ state: "attached", timeout: 60_000 })
    .catch(() => undefined);
  await expandAllCategories(page);
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await waitForSnifferTasks(sniffer, page, 25_000);

  const usersStarted = Date.now();
  if (appTaskUsers.length === 0) {
    const viaApi = await getUsersViaApi(page);
    if (viaApi.length > 0) appTaskUsers.push(...viaApi);
    else {
      warnings.push(
        "users: get_users via API returned empty, rules may skip user checks",
      );
    }
  }
  const usersMs = Date.now() - usersStarted;
  const usersCount = appTaskUsers.length;

  const replayHeaders = sniffer.apiRequestHeaders;
  const sprints = await getBoardSprints(page, boardId, replayHeaders);
  let sprintId =
    sniffer.sprintId ?? resolveSprintId(sprints, warnings);
  if (sprintId == null) {
    warnings.push("sprintId: not from sniffer or get_sprints, retry after board idle");
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    const retrySprints = await getBoardSprints(page, boardId, replayHeaders);
    sprintId = sniffer.sprintId ?? resolveSprintId(retrySprints, warnings);
  }
  if (sprintId == null) {
    throw new Error("API collector: sprintId not resolved (get_sprints empty)");
  }

  const statesStarted = Date.now();
  let states =
    sniffer.states.length > 0
      ? [...sniffer.states]
      : await getBoardStates(page, boardId, sprintId, replayHeaders);
  const statesMs = Date.now() - statesStarted;

  const blocksStarted = Date.now();
  let blocks =
    sniffer.blocks.length > 0
      ? [...sniffer.blocks]
      : await getBoardBlocks(page, boardId, sprintId, replayHeaders);
  const blocksMs = Date.now() - blocksStarted;

  if (blocks.length === 0 && sniffer.blockIds.size > 0) {
    blocks = [...sniffer.blockIds].map((id) => ({ id, name: `block:${id}` }));
    warnings.push("get_blocks empty; using blockIds from network sniffer");
  }
  if (blocks.length === 0) {
    warnings.push("get_blocks returned no blocks");
  }
  if (states.length === 0) {
    const fetched = await getBoardStates(page, boardId, sprintId, replayHeaders);
    if (fetched.length > 0) states = fetched;
  }

  const statesById = buildStatesMap(states);
  const blocksById = buildBlocksMap(blocks);
  const usersById = buildUsersMap(appTaskUsers);

  const taskMap = new Map<string, RawTask>();
  let getTasksRequests = 0;
  const getTasksStarted = Date.now();

  const ingestItems = (blockId: number, items: ApiTaskListItem[]) => {
    for (const item of items) {
      const raw = mapApiTaskListItemToRawTask(item, {
        boardUrl,
        boardId,
        blockId,
        statesById,
        blocksById,
        usersById,
      });
      if (!raw.id) continue;
      if (!taskMap.has(raw.id)) taskMap.set(raw.id, raw);
    }
  };

  for (const [blockId, items] of sniffer.capturedTasks) {
    getTasksRequests++;
    ingestItems(blockId, items);
  }

  const blocksToFetch =
    Object.keys(replayHeaders).length > 0
      ? blocks
      : blocks.filter((b) => {
          const captured = sniffer.capturedTasks.get(b.id);
          return !captured || captured.length === 0;
        });

  if (blocksToFetch.length > 0) {
    if (Object.keys(replayHeaders).length === 0) {
      warnings.push(
        "explicit get_tasks skipped: no board API headers captured from browser",
      );
    } else {
      await runPool(blocksToFetch, collectorCfg.apiConcurrency, async (block) => {
        getTasksRequests++;
        const items = await getBoardTasks(
          page,
          boardId,
          block.id,
          sprintId!,
          replayHeaders,
        );
        ingestItems(block.id, items);
      });
    }
  }

  const getTasksMs = Date.now() - getTasksStarted;
  let tasks = [...taskMap.values()];

  const taskIdFilter = process.env.AUDIT_TASK_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (taskIdFilter?.length) {
    tasks = tasks.filter((t) => t.id && taskIdFilter.includes(t.id));
  }
  const ignored = filterTasksByIgnored(tasks, boardUrl);
  tasks = ignored.tasks;

  const totalOnBoard = tasks.length;

  const detailsTargets = filterTasksForDetailsLoad(
    tasks,
    collectorCfg.detailsMode,
  );
  const detailsStarted = Date.now();
  let detailsLoaded = 0;

  await runPool(detailsTargets, collectorCfg.apiConcurrency, async (task) => {
    const details = await getTaskDetails(
      page,
      boardId,
      task.id!,
      replayHeaders,
    );
    if (!details) return;
    const merged = mergeTaskDetailsIntoRawTask(task, details, {
      statesById,
      blocksById,
      usersById,
    });
    Object.assign(task, merged);
    detailsLoaded++;
  });

  const detailsMs = Date.now() - detailsStarted;

  sniffer.stop();
  stopApiDiscovery();
  stopCommentsDiscovery();

  let commentsAudit: Awaited<ReturnType<typeof enrichTasksWithComments>> | undefined;
  if (commentsConfig.mode !== "off") {
    const commentsBoardUrl = resolveCommentsBoardUrl(
      boardUrl,
      options.commentsBoardUrl,
    );
    const commentsBoard = resolveCommentsBoardContext(commentsBoardUrl);
    if (commentsBoard) {
      const useMainTasks = isSameCommentsBoard(boardUrl, commentsBoardUrl);
      const tasksForComments = useMainTasks
        ? tasks
        : await collectRawTasksForCommentsBoard(page, commentsBoardUrl);
      commentsAudit = await enrichTasksWithComments(
        page,
        tasksForComments,
        commentsConfig,
        commentsBoard,
      );
    }
  }

  if (options.maxCards && options.maxCards > 0) {
    tasks = tasks.slice(0, options.maxCards);
  }

  const totalMs = Date.now() - totalStarted;
  const stats: ApiCollectorStats = {
    boardUrl,
    boardId,
    sprintId,
    statesCount: states.length,
    statesMs,
    blocksCount: blocks.length,
    blocksMs,
    getTasksRequests,
    getTasksMs,
    tasksCollected: totalOnBoard,
    detailsLoaded,
    detailsMs,
    commentsLoaded: commentsAudit?.checkedComments ?? 0,
    commentsMs: commentsAudit?.durationMs ?? 0,
    usersCount,
    usersMs,
    totalMs,
    warnings,
  };

  log.info(
    `[api-collector] board=${boardId} tasks=${totalOnBoard} details=${detailsLoaded} comments=${commentsAudit?.checkedComments ?? 0} users=${usersCount} total=${Math.round(totalMs / 1000)}s`,
  );
  if (warnings.length) {
    for (const w of warnings) log.info(`[api-collector] warning: ${w}`);
  }

  return {
    tasks,
    totalOnBoard,
    appTaskUsers,
    commentsAudit,
    ignoredCount: ignored.skippedCount,
    ignoredUrls: ignored.skippedUrls,
    stats,
  };
}

/** API-first сбор задач: Playwright только для сессии, данные через внутренние API. */
export async function collectTasksViaApi(
  boardUrl: string,
  options: CollectTasksOptions = {},
): Promise<CollectTasksResult> {
  assertProfileExists();
  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const appTaskUsers: AppTaskUser[] = [];
    const result = await collectTasksViaApiOnPage(
      page,
      boardUrl,
      options,
      appTaskUsers,
    );
    log.info(`AppTask users: ${result.appTaskUsers.length}`);
    return {
      tasks: result.tasks,
      totalOnBoard: result.totalOnBoard,
      appTaskUsers: result.appTaskUsers,
      commentsAudit: result.commentsAudit,
      ignoredCount: result.ignoredCount ?? 0,
      ignoredUrls: result.ignoredUrls ?? [],
    };
  } finally {
    await context.close();
  }
}
