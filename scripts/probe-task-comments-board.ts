/**
 * Board-wide diagnostic: find all tasks with non-empty commentList on a board.
 * Does not change RawTask, rules, or audit flow.
 *
 * Run:
 *   npm run probe:comments:board -- --board-url "https://apptask.ru/c/7/board/54" --limit 300
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import { openTaskCard } from "../src/adapters/apptask/card.js";
import { collectTaskRefsFromBoard } from "../src/adapters/apptask/collect.js";
import { BOARD_SELECTORS, TASK_MODAL_SELECTORS } from "../src/adapters/apptask/selectors.js";
import type { TaskRef } from "../src/adapters/apptask/task-ref.js";
import { boardUrlPattern, parseBoardId, parseTaskIdFromUrl } from "../src/adapters/apptask/urls.js";

const COMMENTS_ROOT = path.join("output", "debug", "comments");
const GET_TASK_COMMENTS_RE = /\/board\/get_task_comments/i;

type CliOptions = {
  boardUrl: string;
  limit: number;
};

type GetTaskCommentsPayload = {
  result?: number;
  data?: { id?: number; commentList?: unknown[] };
};

type CommentStructureFlags = {
  hasId: boolean;
  hasCommentId: boolean;
  hasAuthor: boolean;
  hasCreatedAt: boolean;
  hasTextField: boolean;
  hasReplyRelation: boolean;
  hasResolvedStatus: boolean;
  hasRepliesThread: boolean;
};

type StructureAnalysis = CommentStructureFlags & {
  commentsCount: number;
  firstCommentKeys: string[];
  allCommentKeysUnique: string[];
  commentsWithParentId: number;
  firstCommentFull: unknown;
};

type FoundEntry = {
  taskId: number | string;
  taskUrl: string;
  title: string | null;
  commentsCount: number;
  commentKeys: string[];
  hasCommentId: boolean;
  hasAuthor: boolean;
  hasCreatedAt: boolean;
  hasReplyRelation: boolean;
  hasResolvedStatus: boolean;
  rawFile: string;
};

type CheckedEntry = {
  taskId: string | null;
  taskUrl: string | null;
  title: string | null;
  commentsCount: number;
  error?: string;
};

function parseCli(argv: string[]): CliOptions {
  let boardUrl = "";
  let limit = 300;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--board-url":
        boardUrl = next ?? "";
        i++;
        break;
      case "--limit":
        limit = Number(next ?? "300");
        i++;
        break;
      default:
        break;
    }
  }

  if (!boardUrl.trim()) {
    console.error("--board-url is required");
    console.error(
      'Example: npx tsx scripts/probe-task-comments-board.ts --board-url "https://apptask.ru/c/7/board/54" --limit 300',
    );
    process.exit(1);
  }

  if (!Number.isFinite(limit) || limit < 1) limit = 300;
  return { boardUrl: boardUrl.trim(), limit };
}

function boardOutDir(boardId: string): string {
  return path.join(COMMENTS_ROOT, `board-${boardId}`);
}

function summaryPath(boardId: string): string {
  return path.join(COMMENTS_ROOT, `board-${boardId}-comments-summary.json`);
}

function schemaPath(boardId: string): string {
  return path.join(COMMENTS_ROOT, `board-${boardId}-comments-schema.json`);
}

function collectKeysFromObject(obj: unknown, keys = new Set<string>()): Set<string> {
  if (!obj || typeof obj !== "object") return keys;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    keys.add(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      collectKeysFromObject(value, keys);
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      collectKeysFromObject(value[0], keys);
    }
  }
  return keys;
}

function flagsFromKeys(keys: string[]): CommentStructureFlags {
  const keysLower = keys.map((k) => k.toLowerCase());
  const matchKey = (re: RegExp) => keysLower.some((k) => re.test(k));
  return {
    hasId: matchKey(/^id$/),
    hasCommentId: matchKey(/^commentid$|\.commentid/),
    hasAuthor: matchKey(/author|username|user|creator|member|realname/),
    hasCreatedAt: matchKey(/createdat|created|date|time|posted/),
    hasTextField: matchKey(/^content$|^text$|^comment$|^body$|^message$/),
    hasReplyRelation: matchKey(/parentid|parentcommentid|parent_id|replyto|reply_to/),
    hasResolvedStatus: matchKey(/resolved|isresolved|closed|^status$/),
    hasRepliesThread: matchKey(/replies|thread|children|nested/),
  };
}

function analyzeCommentList(commentList: unknown[]): StructureAnalysis {
  const allKeys = new Set<string>();
  for (const item of commentList) {
    collectKeysFromObject(item, allKeys);
  }
  const keys = [...allKeys].sort();
  const flags = flagsFromKeys(keys);
  const first = commentList[0] ?? null;
  const withParent = commentList.filter(
    (c) =>
      c &&
      typeof c === "object" &&
      (c as Record<string, unknown>).parentId != null &&
      (c as Record<string, unknown>).parentId !== 0,
  ).length;

  return {
    ...flags,
    commentsCount: commentList.length,
    firstCommentKeys:
      first && typeof first === "object"
        ? Object.keys(first as Record<string, unknown>).sort()
        : [],
    allCommentKeysUnique: keys,
    commentsWithParentId: withParent,
    firstCommentFull: first,
  };
}

function mergeFlags(a: CommentStructureFlags, b: CommentStructureFlags): CommentStructureFlags {
  return {
    hasId: a.hasId || b.hasId,
    hasCommentId: a.hasCommentId || b.hasCommentId,
    hasAuthor: a.hasAuthor || b.hasAuthor,
    hasCreatedAt: a.hasCreatedAt || b.hasCreatedAt,
    hasTextField: a.hasTextField || b.hasTextField,
    hasReplyRelation: a.hasReplyRelation || b.hasReplyRelation,
    hasResolvedStatus: a.hasResolvedStatus || b.hasResolvedStatus,
    hasRepliesThread: a.hasRepliesThread || b.hasRepliesThread,
  };
}

function buildSchema(
  uniqueKeys: Set<string>,
  exampleComment: unknown,
  merged: CommentStructureFlags,
  totalComments: number,
  totalWithParent: number,
): {
  uniqueCommentKeys: string[];
  exampleComment: unknown;
  hasReplyRelation: boolean;
  hasResolvedStatus: boolean;
  canDetermineQuestionAnsweredExactly: boolean;
  reason: string;
} {
  const hasThreading =
    merged.hasReplyRelation || merged.hasRepliesThread || totalWithParent > 0;
  const hasResolved = merged.hasResolvedStatus;

  let canDetermine = false;
  let reason: string;

  if (totalComments === 0) {
    reason = "На проверенных задачах commentList[] не найден";
  } else if (hasThreading && hasResolved) {
    canDetermine = true;
    reason =
      "Есть parentId/reply/thread и resolved/isResolved/closed/status — точная проверка «вопрос получил ответ» возможна без эвристики по тексту";
  } else if (hasThreading && !hasResolved) {
    reason =
      `Есть связь parent/reply (${totalWithParent} комментариев с parentId), но нет resolved/isResolved/closed — закрытие вопроса по API не подтвердить`;
  } else {
    reason =
      "Плоский commentList без parent/reply и без resolved — точная проверка «вопрос получил ответ» невозможна без эвристики";
  }

  return {
    uniqueCommentKeys: [...uniqueKeys].sort(),
    exampleComment,
    hasReplyRelation: hasThreading,
    hasResolvedStatus: hasResolved,
    canDetermineQuestionAnsweredExactly: canDetermine,
    reason,
  };
}

async function enrichRefsWithTaskIds(
  page: Page,
  refs: TaskRef[],
): Promise<TaskRef[]> {
  const enriched: TaskRef[] = [];
  for (const ref of refs) {
    if (ref.taskId) {
      enriched.push(ref);
      continue;
    }
    if (!ref.titlePreview) {
      enriched.push(ref);
      continue;
    }
    const card = page
      .locator(`[id="${ref.categoryId}"]`)
      .locator(BOARD_SELECTORS.taskCard)
      .filter({ hasText: ref.titlePreview })
      .first();
    const rawId = await card.getAttribute("id").catch(() => null);
    const taskId = rawId && /^\d+$/.test(rawId) ? rawId : null;
    enriched.push({ ...ref, taskId });
  }
  return enriched;
}

async function activateCommentsTab(page: Page): Promise<void> {
  const commentsTab = page
    .locator("button.modal-card-tabs-list__button")
    .filter({ hasText: /комментарии/i });
  if ((await commentsTab.count()) > 0) {
    await commentsTab.first().click({ timeout: 5_000 }).catch(() => undefined);
  }
  const toggleText = page.locator(".js-commentText").first();
  const label = ((await toggleText.textContent().catch(() => "")) ?? "").trim();
  if (/показать/i.test(label)) {
    await page
      .locator(".modal-card-tab__title--toggle")
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined);
  }
  await page.waitForTimeout(400);
}

async function readTaskTitle(page: Page): Promise<string | null> {
  const titleLoc = page.locator(TASK_MODAL_SELECTORS.title).first();
  if (await titleLoc.count()) {
    const text = (await titleLoc.textContent())?.trim();
    if (text) return text;
  }
  return null;
}

async function waitForTaskCommentsResponse(
  page: Page,
  timeoutMs: number,
): Promise<Response | null> {
  try {
    return await page.waitForResponse(
      (r) =>
        GET_TASK_COMMENTS_RE.test(r.url()) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: timeoutMs },
    );
  } catch {
    return null;
  }
}

function extractCommentList(json: unknown): unknown[] {
  const payload = json as GetTaskCommentsPayload;
  const list = payload?.data?.commentList;
  return Array.isArray(list) ? list : [];
}

async function saveTaskArtifacts(
  boardId: string,
  taskId: string,
  taskUrl: string,
  title: string | null,
  raw: unknown,
  analysis: StructureAnalysis,
  page: Page,
): Promise<string> {
  const dir = boardOutDir(boardId);
  fs.mkdirSync(dir, { recursive: true });
  const base = `task-${taskId}`;
  const jsonFile = path.join(dir, `${base}.json`);
  const htmlFile = path.join(dir, `${base}.html`);
  const pngFile = path.join(dir, `${base}.png`);

  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        taskId,
        taskUrl,
        title,
        apiUrl: "https://host2201.apptask.ru/board/get_task_comments",
        capturedAt: new Date().toISOString(),
        commentsCount: analysis.commentsCount,
        rawResponse: raw,
        structureAnalysis: analysis,
      },
      null,
      2,
    ),
    "utf8",
  );

  const modal = page.locator(TASK_MODAL_SELECTORS.root);
  try {
    const html = await modal.evaluate((el) => el.outerHTML);
    fs.writeFileSync(htmlFile, html, "utf8");
  } catch {
    fs.writeFileSync(htmlFile, "<!-- modal unavailable -->", "utf8");
  }
  await page.screenshot({ path: pngFile, fullPage: false }).catch(() => undefined);

  return path
    .join("output", "debug", "comments", `board-${boardId}`, `${base}.json`)
    .replace(/\\/g, "/");
}

async function ensureCardClosed(
  page: Page,
  boardUrl: string,
  boardId: string,
): Promise<void> {
  const modal = page.locator(".modal.detailed-task, .modal-card.task-details");
  for (let i = 0; i < 5; i++) {
    if (!(await modal.first().isVisible().catch(() => false))) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const closeBtn = page
      .locator(
        ".right-sidebar__close-btn, .modal-card-header button, .modal.detailed-task .modal-card-action__button",
      )
      .first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  }

  const modalVisible = await modal.first().isVisible().catch(() => false);
  if (modalVisible || !boardUrlPattern(boardId).test(page.url())) {
    await page.goto(boardUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(800);
  }
}

async function openTaskForProbe(
  page: Page,
  ref: TaskRef,
  boardId: string,
  boardUrl: string,
): Promise<void> {
  await ensureCardClosed(page, boardUrl, boardId);

  if (ref.taskId) {
    const taskUrl = `${boardUrl.replace(/\/$/, "")}/${ref.taskId}`;
    await page.goto(taskUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .locator(TASK_MODAL_SELECTORS.root)
      .waitFor({ state: "visible", timeout: 45_000 });
    return;
  }

  const opened = await openTaskCard(page, ref, boardUrl, boardId);
  if (!opened.ok) throw new Error(opened.reason);
}

async function probeOneTask(
  page: Page,
  ref: TaskRef,
  boardId: string,
  boardUrl: string,
): Promise<{
  taskId: string | null;
  taskUrl: string | null;
  title: string | null;
  commentList: unknown[];
  raw: unknown | null;
  error?: string;
}> {
  const responsePromise = waitForTaskCommentsResponse(page, 35_000);

  try {
    await openTaskForProbe(page, ref, boardId, boardUrl);
    await activateCommentsTab(page);

    let response = await responsePromise;
    if (!response) {
      response = await waitForTaskCommentsResponse(page, 12_000);
    }

    const taskUrl = page.url();
    const taskId = parseTaskIdFromUrl(taskUrl) ?? ref.taskId;
    const title = (await readTaskTitle(page)) ?? ref.titlePreview;

    if (!response) {
      await ensureCardClosed(page, boardUrl, boardId);
      return {
        taskId,
        taskUrl,
        title,
        commentList: [],
        raw: null,
        error: "get_task_comments not captured",
      };
    }

    const raw = await response.json().catch(() => null);
    const commentList = extractCommentList(raw);

    await ensureCardClosed(page, boardUrl, boardId);

    return { taskId, taskUrl, title, commentList, raw };
  } catch (err) {
    await ensureCardClosed(page, boardUrl, boardId);
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: ref.taskId,
      taskUrl: page.url(),
      title: ref.titlePreview,
      commentList: [],
      raw: null,
      error: message,
    };
  }
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const boardId = parseBoardId(opts.boardUrl);
  if (!boardId) {
    console.error(`Invalid board URL: ${opts.boardUrl}`);
    process.exit(1);
  }

  fs.mkdirSync(boardOutDir(boardId), { recursive: true });
  assertProfileExists();

  console.log("=== Board comments probe ===\n");
  console.log(`Board: ${opts.boardUrl}`);
  console.log(`Limit: ${opts.limit}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  const checked: CheckedEntry[] = [];
  const found: FoundEntry[] = [];
  let errors = 0;

  const globalKeys = new Set<string>();
  let mergedFlags: CommentStructureFlags = {
    hasId: false,
    hasCommentId: false,
    hasAuthor: false,
    hasCreatedAt: false,
    hasTextField: false,
    hasReplyRelation: false,
    hasResolvedStatus: false,
    hasRepliesThread: false,
  };
  let exampleComment: unknown = null;
  let totalCommentsSampled = 0;
  let totalWithParent = 0;

  try {
    await openBoardWithReadiness(page, opts.boardUrl);

    const allRefs = await enrichRefsWithTaskIds(
      page,
      await collectTaskRefsFromBoard(page),
    );
    const refs = allRefs.slice(0, opts.limit);

    console.log(`totalTaskRefs=${allRefs.length}, checking=${refs.length}\n`);

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!;
      if (!ref.taskId) {
        checked.push({
          taskId: null,
          taskUrl: null,
          title: ref.titlePreview,
          commentsCount: 0,
          error: "no taskId on ref",
        });
        errors++;
        continue;
      }

      console.log(
        `[${i + 1}/${refs.length}] id=${ref.taskId} "${(ref.titlePreview ?? "").slice(0, 50)}"`,
      );

      const result = await probeOneTask(page, ref, boardId, opts.boardUrl);
      const count = result.commentList.length;

      if (result.error) errors++;

      checked.push({
        taskId: result.taskId,
        taskUrl: result.taskUrl,
        title: result.title,
        commentsCount: count,
        error: result.error,
      });

      if (count > 0 && result.raw) {
        const analysis = analyzeCommentList(result.commentList);
        const taskIdStr = String(result.taskId ?? ref.taskId);
        const rawFile = await saveTaskArtifacts(
          boardId,
          taskIdStr,
          result.taskUrl ?? "",
          result.title,
          result.raw,
          analysis,
          page,
        );

        for (const item of result.commentList) {
          collectKeysFromObject(item, globalKeys);
          if (!exampleComment && item) exampleComment = item;
        }
        mergedFlags = mergeFlags(mergedFlags, analysis);
        totalCommentsSampled += count;
        totalWithParent += analysis.commentsWithParentId;

        found.push({
          taskId: result.taskId ?? taskIdStr,
          taskUrl: result.taskUrl ?? "",
          title: result.title,
          commentsCount: count,
          commentKeys: analysis.allCommentKeysUnique,
          hasCommentId: analysis.hasCommentId || analysis.hasId,
          hasAuthor: analysis.hasAuthor,
          hasCreatedAt: analysis.hasCreatedAt,
          hasReplyRelation: analysis.hasReplyRelation,
          hasResolvedStatus: analysis.hasResolvedStatus,
          rawFile,
        });

        console.log(`  → comments=${count} parentId=${analysis.commentsWithParentId}`);
      } else {
        console.log(`  → comments=0${result.error ? ` (${result.error})` : ""}`);
      }
    }

    const schema = buildSchema(
      globalKeys,
      exampleComment,
      mergedFlags,
      totalCommentsSampled,
      totalWithParent,
    );

    const summary = {
      boardUrl: opts.boardUrl,
      boardId,
      totalTaskRefs: allRefs.length,
      checkedTasks: checked.length,
      tasksWithComments: found.length,
      tasksWithoutComments: checked.filter((c) => c.commentsCount === 0).length,
      errors,
      found,
      checked,
      schemaFile: path
        .join("output", "debug", "comments", `board-${boardId}-comments-schema.json`)
        .replace(/\\/g, "/"),
      message:
        found.length === 0
          ? `Checked ${checked.length} tasks on board ${boardId}, no non-empty commentList`
          : undefined,
    };

    fs.writeFileSync(summaryPath(boardId), JSON.stringify(summary, null, 2), "utf8");
    fs.writeFileSync(schemaPath(boardId), JSON.stringify(schema, null, 2), "utf8");

    console.log("\n=== Summary ===");
    console.log(
      `checked=${summary.checkedTasks} withComments=${summary.tasksWithComments} without=${summary.tasksWithoutComments} errors=${errors}`,
    );
    console.log(`Saved: ${summaryPath(boardId)}`);
    console.log(`Schema: ${schemaPath(boardId)}`);
    console.log(JSON.stringify(schema, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
