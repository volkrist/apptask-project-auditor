/**
 * Bulk diagnostic: find tasks with non-empty commentList from get_task_comments.
 * Does not change RawTask, rules, or audit flow.
 *
 * Run:
 *   npm run probe:comments:bulk -- --board-url "https://apptask.ru/c/7/board/445" --limit 50 --stop-after 5
 * Windows alternative (if npm args fail):
 *   npx tsx scripts/probe-task-comments-bulk.ts --board-url "https://apptask.ru/c/7/board/445" --limit 50 --stop-after 5
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
import {
  boardUrlPattern,
  parseBoardId,
  parseTaskIdFromUrl,
} from "../src/adapters/apptask/urls.js";

const COMMENTS_DIR = path.join("output", "debug", "comments");
const SUMMARY_PATH = path.join(COMMENTS_DIR, "comments-bulk-summary.json");

const GET_TASK_COMMENTS_RE = /\/board\/get_task_comments/i;

type CliOptions = {
  boardUrl: string;
  limit: number;
  stopAfter: number;
  headed: boolean;
  slow: boolean;
};

type GetTaskCommentsPayload = {
  result?: number;
  data?: {
    id?: number;
    commentList?: unknown[];
  };
};

type StructureAnalysis = {
  commentsCount: number;
  firstCommentKeys: string[];
  allCommentKeysUnique: string[];
  hasId: boolean;
  hasCommentId: boolean;
  hasReplyRelation: boolean;
  hasAuthor: boolean;
  hasCreatedAt: boolean;
  hasResolvedStatus: boolean;
  hasRepliesThread: boolean;
  firstCommentFull: unknown;
};

type FoundEntry = {
  taskId: number | string;
  taskUrl: string;
  title: string | null;
  commentsCount: number;
  commentKeys: string[];
  hasReplyRelation: boolean;
  hasResolvedStatus: boolean;
  rawFile: string;
  structureAnalysis: StructureAnalysis;
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
  let limit = 50;
  let stopAfter = 5;
  let headed = false;
  let slow = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--board-url":
        boardUrl = next ?? "";
        i++;
        break;
      case "--limit":
        limit = Number(next ?? "50");
        i++;
        break;
      case "--stop-after":
        stopAfter = Number(next ?? "5");
        i++;
        break;
      case "--headed":
        headed = true;
        break;
      case "--slow":
        slow = true;
        break;
      default:
        break;
    }
  }

  if (!boardUrl.trim()) {
    console.error("--board-url is required");
    console.error(
      'Example: npx tsx scripts/probe-task-comments-bulk.ts --board-url "https://apptask.ru/c/7/board/445" --limit 50 --stop-after 5',
    );
    process.exit(1);
  }

  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  if (!Number.isFinite(stopAfter) || stopAfter < 1) stopAfter = 5;

  return { boardUrl: boardUrl.trim(), limit, stopAfter, headed, slow };
}

function ensureCommentsDir(): void {
  fs.mkdirSync(COMMENTS_DIR, { recursive: true });
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

function analyzeCommentList(commentList: unknown[]): StructureAnalysis {
  const allKeys = new Set<string>();
  for (const item of commentList) {
    collectKeysFromObject(item, allKeys).forEach((k) => allKeys.add(k));
  }
  const keys = [...allKeys];
  const keysLower = keys.map((k) => k.toLowerCase());

  const matchKey = (re: RegExp) => keysLower.some((k) => re.test(k));

  const first = commentList[0] ?? null;

  return {
    commentsCount: commentList.length,
    firstCommentKeys:
      first && typeof first === "object"
        ? Object.keys(first as Record<string, unknown>)
        : [],
    allCommentKeysUnique: keys.sort(),
    hasId: matchKey(/^id$/),
    hasCommentId: matchKey(/commentid/),
    hasReplyRelation: matchKey(/parent|replyto|reply_to|parentcomment/),
    hasAuthor: matchKey(/author|user|username|creator|member/),
    hasCreatedAt: matchKey(/created|date|time|posted/),
    hasResolvedStatus: matchKey(/resolved|closed|status/),
    hasRepliesThread: matchKey(/replies|thread|children|nested/),
    firstCommentFull: first,
  };
}

/** collectTaskRefsFromBoard skips numeric ids shorter than 4 chars — restore for probe. */
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

async function ensureCardClosed(
  page: Page,
  boardUrl: string,
  boardId: string,
): Promise<void> {
  const modal = page.locator(".modal.detailed-task, .modal-card.task-details");
  for (let i = 0; i < 4; i++) {
    if (!(await modal.first().isVisible().catch(() => false))) break;
    const closeBtn = page
      .locator(
        ".right-sidebar__close-btn, .modal-card-header button, .modal.detailed-task .modal-card-action__button",
      )
      .first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click({ force: true }).catch(() => undefined);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }

  const onBoard = boardUrlPattern(boardId).test(page.url());
  const modalVisible = await modal.first().isVisible().catch(() => false);
  if (modalVisible || !onBoard) {
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
    const base = boardUrl.replace(/\/$/, "");
    const taskUrl = `${base}/${ref.taskId}`;
    await page.goto(taskUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .locator(TASK_MODAL_SELECTORS.root)
      .waitFor({ state: "visible", timeout: 30_000 });
    return;
  }

  await openTaskCard(page, ref, boardId);
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
      (r) => GET_TASK_COMMENTS_RE.test(r.url()) && r.request().method() === "POST",
      { timeout: timeoutMs },
    );
  } catch {
    return null;
  }
}

function extractCommentList(json: unknown): {
  taskId: number | string | null;
  commentList: unknown[];
  raw: unknown;
} {
  const payload = json as GetTaskCommentsPayload;
  const list = payload?.data?.commentList;
  return {
    taskId: payload?.data?.id ?? null,
    commentList: Array.isArray(list) ? list : [],
    raw: json,
  };
}

async function saveFoundTaskArtifacts(
  taskId: string,
  taskUrl: string,
  title: string | null,
  raw: unknown,
  analysis: StructureAnalysis,
  page: Page,
): Promise<string> {
  const base = `found-task-${taskId}`;
  const jsonPath = path.join(COMMENTS_DIR, `${base}.json`);
  const htmlPath = path.join(COMMENTS_DIR, `${base}.html`);
  const pngPath = path.join(COMMENTS_DIR, `${base}.png`);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        taskId,
        taskUrl,
        title,
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
    fs.writeFileSync(htmlPath, html, "utf8");
  } catch {
    /* modal may already be closing */
  }
  await page.screenshot({ path: pngPath, fullPage: false }).catch(() => undefined);

  return path.join("output", "debug", "comments", `${base}.json`).replace(/\\/g, "/");
}

async function probeOneTask(
  page: Page,
  ref: TaskRef,
  boardId: string,
  boardUrl: string,
  slow: boolean,
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
      response = await waitForTaskCommentsResponse(page, 10_000);
    }

    const taskUrl = page.url();
    const taskId = parseTaskIdFromUrl(taskUrl) ?? ref.taskId;
    const title = (await readTaskTitle(page)) ?? ref.titlePreview;

    if (!response) {
      await ensureCardClosed(page, boardUrl, boardId);
      if (slow) await page.waitForTimeout(800);
      return {
        taskId,
        taskUrl,
        title,
        commentList: [],
        raw: null,
        error: "get_task_comments response not captured",
      };
    }

    const raw = (await response.json().catch(() => null)) as unknown;
    const { commentList } = extractCommentList(raw);

    await ensureCardClosed(page, boardUrl, boardId);
    if (slow) await page.waitForTimeout(800);

    return { taskId, taskUrl, title, commentList, raw };
  } catch (err) {
    await ensureCardClosed(page, boardUrl, boardId).catch(() => undefined);
    if (slow) await page.waitForTimeout(800);
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

  ensureCommentsDir();
  assertProfileExists();

  if (opts.headed) {
    console.log("--headed: using headed Chromium (default for persistent profile)");
  }

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  const checked: CheckedEntry[] = [];
  const found: FoundEntry[] = [];
  let errors = 0;

  try {
    console.log("Opening board:", opts.boardUrl);
    await openBoardWithReadiness(page, opts.boardUrl);

    const allRefs = await enrichRefsWithTaskIds(
      page,
      await collectTaskRefsFromBoard(page),
    );
    const refs = allRefs.slice(0, opts.limit);
    console.log(
      `Collected ${allRefs.length} refs, checking first ${refs.length} (limit=${opts.limit}, stop-after=${opts.stopAfter})`,
    );

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]!;
      console.log(
        `[${i + 1}/${refs.length}] id=${ref.taskId ?? "?"} "${ref.titlePreview ?? ""}"`,
      );

      const result = await probeOneTask(
        page,
        ref,
        boardId,
        opts.boardUrl,
        opts.slow,
      );
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
        const taskIdStr = String(result.taskId ?? parseTaskIdFromUrl(result.taskUrl ?? "") ?? i);
        const analysis = analyzeCommentList(result.commentList);
        const rawFile = await saveFoundTaskArtifacts(
          taskIdStr,
          result.taskUrl ?? "",
          result.title,
          result.raw,
          analysis,
          page,
        );

        found.push({
          taskId: result.taskId ?? taskIdStr,
          taskUrl: result.taskUrl ?? "",
          title: result.title,
          commentsCount: count,
          commentKeys: analysis.allCommentKeysUnique,
          hasReplyRelation: analysis.hasReplyRelation,
          hasResolvedStatus: analysis.hasResolvedStatus,
          rawFile,
          structureAnalysis: analysis,
        });

        console.log(
          `  → comments=${count} keys=${analysis.allCommentKeysUnique.join(", ")}`,
        );
        console.log(
          `  → first comment:`,
          JSON.stringify(analysis.firstCommentFull, null, 2).slice(0, 1200),
        );

        if (found.length >= opts.stopAfter) {
          console.log(`Stop-after ${opts.stopAfter} reached.`);
          break;
        }
      } else {
        console.log(`  → comments=0${result.error ? ` (${result.error})` : ""}`);
      }
    }

    const tasksWithComments = found.length;
    const tasksWithoutComments = checked.filter((c) => c.commentsCount === 0).length;

    const summary = {
      boardUrl: opts.boardUrl,
      checkedTasks: checked.length,
      tasksWithComments,
      tasksWithoutComments,
      errors,
      found: found.map(({ structureAnalysis: _sa, ...rest }) => rest),
      checked,
      message:
        tasksWithComments === 0
          ? `Checked ${checked.length} tasks, comments not found`
          : undefined,
    };

    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n--- Summary ---");
    console.log(JSON.stringify(summary, null, 2));
    console.log("Saved:", SUMMARY_PATH);

    if (tasksWithComments === 0) {
      console.log(`Checked ${checked.length} tasks, comments not found`);
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
