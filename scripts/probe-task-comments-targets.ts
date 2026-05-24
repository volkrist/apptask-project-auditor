/**
 * Targeted diagnostic: get_task_comments for specific task URLs (e.g. board 54).
 * Does not change RawTask, rules, or audit flow.
 *
 * Run:
 *   npx tsx scripts/probe-task-comments-targets.ts --task-urls "https://apptask.ru/c/7/board/54/5765,..."
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { TASK_MODAL_SELECTORS } from "../src/adapters/apptask/selectors.js";
import { parseBoardId, parseTaskIdFromUrl } from "../src/adapters/apptask/urls.js";

const COMMENTS_DIR = path.join("output", "debug", "comments");
const GET_TASK_COMMENTS_RE = /\/board\/get_task_comments/i;

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
  hasAuthor: boolean;
  hasCreatedAt: boolean;
  hasParentId: boolean;
  hasReplyTo: boolean;
  hasResolved: boolean;
  hasIsResolved: boolean;
  hasClosed: boolean;
  hasStatus: boolean;
  hasReplies: boolean;
  hasThread: boolean;
  hasChildren: boolean;
  firstCommentFull: unknown;
};

type TaskProbeResult = {
  taskUrl: string;
  taskId: string | null;
  boardId: string | null;
  title: string | null;
  commentsCount: number;
  apiUrl: string | null;
  rawResponse: unknown | null;
  structureAnalysis: StructureAnalysis;
  artifactBase: string;
  files: { json: string; html: string; png: string };
  error?: string;
};

function parseTaskUrls(argv: string[]): string[] {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === "--task-urls" && next) {
      return next
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
    }
    if (arg.startsWith("--task-urls=")) {
      return arg
        .slice("--task-urls=".length)
        .split(",")
        .map((u) => u.trim())
        .filter(Boolean);
    }
  }
  console.error("--task-urls is required (comma-separated)");
  console.error(
    'Example: npx tsx scripts/probe-task-comments-targets.ts --task-urls "https://apptask.ru/c/7/board/54/5765,https://apptask.ru/c/7/board/54/5780"',
  );
  process.exit(1);
}

function ensureCommentsDir(): void {
  fs.mkdirSync(COMMENTS_DIR, { recursive: true });
}

function artifactBaseName(boardId: string, taskId: string): string {
  return `board-${boardId}-task-${taskId}`;
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
    collectKeysFromObject(item, allKeys);
  }
  const keys = [...allKeys].sort();
  const keysLower = keys.map((k) => k.toLowerCase());
  const matchKey = (re: RegExp) => keysLower.some((k) => re.test(k));

  const first = commentList[0] ?? null;

  return {
    commentsCount: commentList.length,
    firstCommentKeys:
      first && typeof first === "object"
        ? Object.keys(first as Record<string, unknown>).sort()
        : [],
    allCommentKeysUnique: keys,
    hasId: matchKey(/^id$/),
    hasCommentId: matchKey(/^commentid$|\.commentid/),
    hasAuthor: matchKey(/author|username|user|creator|member|realname/),
    hasCreatedAt: matchKey(/createdat|created|date|time|posted/),
    hasParentId: matchKey(/parentid|parentcommentid|parent_id/),
    hasReplyTo: matchKey(/replyto|reply_to/),
    hasResolved: matchKey(/^resolved$/),
    hasIsResolved: matchKey(/isresolved/),
    hasClosed: matchKey(/^closed$/),
    hasStatus: matchKey(/^status$/),
    hasReplies: matchKey(/^replies$/),
    hasThread: matchKey(/thread/),
    hasChildren: matchKey(/children|nested/),
    firstCommentFull: first,
  };
}

function assessExactQaRule(analysis: StructureAnalysis): {
  exactRulePossible: boolean;
  verdict: string;
  rawTaskCommentsProposal: string | null;
} {
  if (analysis.commentsCount === 0) {
    return {
      exactRulePossible: false,
      verdict:
        "commentList[] пуст — структуру комментариев карточки подтвердить нельзя; RawTask.comments не предлагать",
      rawTaskCommentsProposal: null,
    };
  }

  const hasThreading =
    analysis.hasParentId ||
    analysis.hasReplyTo ||
    analysis.hasReplies ||
    analysis.hasThread ||
    analysis.hasChildren;
  const hasResolvedFlag =
    analysis.hasResolved ||
    analysis.hasIsResolved ||
    analysis.hasClosed ||
    analysis.hasStatus;

  if (hasThreading && hasResolvedFlag) {
    return {
      exactRulePossible: true,
      verdict:
        "Есть связь parent/reply и признак resolved/closed/status — точное правило «вопрос получил ответ» возможно без эвристики по тексту",
      rawTaskCommentsProposal:
        "После фиксации маппинга полей: RawTask.comments[] с id, parentId/replyTo, resolved/isResolved, author, createdAt, text",
    };
  }

  if (hasThreading && !hasResolvedFlag) {
    return {
      exactRulePossible: false,
      verdict:
        "Есть parent/reply, но нет resolved/isResolved/closed — связь вопрос→ответ видна, закрытие вопроса подтвердить нельзя",
      rawTaskCommentsProposal:
        "RawTask.comments только после уточнения поля «закрыт» у заказчика или в других API-полях",
    };
  }

  return {
    exactRulePossible: false,
    verdict:
      "Плоский commentList без parent/reply и без resolved — точная проверка «вопрос получил ответ» невозможна без эвристики",
    rawTaskCommentsProposal:
      "RawTask.comments (id, author, createdAt, text) — только для маркеров unresolved_question_keywords_in_card, не для Q→A",
  };
}

async function ensureCardClosed(page: Page): Promise<void> {
  const modal = page.locator(".modal.detailed-task, .modal-card.task-details");
  for (let i = 0; i < 4; i++) {
    if (!(await modal.first().isVisible().catch(() => false))) break;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
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

  await page.waitForTimeout(500);
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

async function probeTaskUrl(page: Page, taskUrl: string): Promise<TaskProbeResult> {
  const boardId = parseBoardId(taskUrl);
  const taskId = parseTaskIdFromUrl(taskUrl);
  const base =
    boardId && taskId ? artifactBaseName(boardId, taskId) : `task-unknown-${Date.now()}`;

  const jsonPath = path.join(COMMENTS_DIR, `${base}.json`);
  const htmlPath = path.join(COMMENTS_DIR, `${base}.html`);
  const pngPath = path.join(COMMENTS_DIR, `${base}.png`);

  const emptyAnalysis = analyzeCommentList([]);

  if (!taskId || !boardId) {
    return {
      taskUrl,
      taskId,
      boardId,
      title: null,
      commentsCount: 0,
      apiUrl: null,
      rawResponse: null,
      structureAnalysis: emptyAnalysis,
      artifactBase: base,
      files: { json: jsonPath, html: htmlPath, png: pngPath },
      error: "invalid task URL (need /board/{id}/{taskId})",
    };
  }

  await ensureCardClosed(page);

  const responsePromise = waitForTaskCommentsResponse(page, 45_000);

  try {
    await page.goto(taskUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page
      .locator(TASK_MODAL_SELECTORS.root)
      .waitFor({ state: "visible", timeout: 45_000 });

    await activateCommentsTab(page);

    let response = await responsePromise;
    if (!response) {
      response = await waitForTaskCommentsResponse(page, 15_000);
    }

    const title = await readTaskTitle(page);
    const finalUrl = page.url();

    if (!response) {
      const payload = { taskUrl: finalUrl, taskId, error: "get_task_comments not captured" };
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
      await page.screenshot({ path: pngPath, fullPage: false }).catch(() => undefined);

      await ensureCardClosed(page);

      return {
        taskUrl: finalUrl,
        taskId,
        boardId,
        title,
        commentsCount: 0,
        apiUrl: null,
        rawResponse: null,
        structureAnalysis: emptyAnalysis,
        artifactBase: base,
        files: { json: jsonPath, html: htmlPath, png: pngPath },
        error: "get_task_comments response not captured",
      };
    }

    const raw = await response.json().catch(() => null);
    const commentList = extractCommentList(raw);
    const analysis = analyzeCommentList(commentList);
    const apiUrl = response.url();

    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          taskUrl: finalUrl,
          taskId,
          boardId,
          title,
          apiUrl,
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
      fs.writeFileSync(htmlPath, html, "utf8");
    } catch {
      fs.writeFileSync(htmlPath, "<!-- modal not available -->", "utf8");
    }
    await page.screenshot({ path: pngPath, fullPage: false });

    await ensureCardClosed(page);

    return {
      taskUrl: finalUrl,
      taskId,
      boardId,
      title,
      commentsCount: analysis.commentsCount,
      apiUrl,
      rawResponse: raw,
      structureAnalysis: analysis,
      artifactBase: base,
      files: { json: jsonPath, html: htmlPath, png: pngPath },
    };
  } catch (err) {
    await ensureCardClosed(page).catch(() => undefined);
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskUrl,
      taskId,
      boardId,
      title: null,
      commentsCount: 0,
      apiUrl: null,
      rawResponse: null,
      structureAnalysis: emptyAnalysis,
      artifactBase: base,
      files: { json: jsonPath, html: htmlPath, png: pngPath },
      error: message,
    };
  }
}

async function main(): Promise<void> {
  const taskUrls = parseTaskUrls(process.argv.slice(2));
  ensureCommentsDir();
  assertProfileExists();

  console.log("=== Task comments targets probe ===\n");
  console.log(`Tasks: ${taskUrls.length}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  const results: TaskProbeResult[] = [];

  try {
    for (let i = 0; i < taskUrls.length; i++) {
      const url = taskUrls[i]!;
      console.log(`\n[${i + 1}/${taskUrls.length}] ${url}`);
      const result = await probeTaskUrl(page, url);
      results.push(result);

      console.log(
        `  comments=${result.commentsCount}${result.error ? ` error=${result.error}` : ""}`,
      );
      if (result.commentsCount > 0) {
        console.log(
          `  keys: ${result.structureAnalysis.allCommentKeysUnique.join(", ")}`,
        );
      }
      console.log(`  saved: ${result.artifactBase}`);
    }

    const boardId = results.find((r) => r.boardId)?.boardId ?? "unknown";
    const summaryPath = path.join(
      COMMENTS_DIR,
      `board-${boardId}-comments-summary.json`,
    );

    const tasks = results.map((r) => {
      const assessment = assessExactQaRule(r.structureAnalysis);
      return {
        taskUrl: r.taskUrl,
        taskId: r.taskId,
        boardId: r.boardId,
        title: r.title,
        commentsCount: r.commentsCount,
        apiUrl: r.apiUrl,
        error: r.error ?? null,
        files: {
          json: path.join("output", "debug", "comments", `${r.artifactBase}.json`),
          html: path.join("output", "debug", "comments", `${r.artifactBase}.html`),
          png: path.join("output", "debug", "comments", `${r.artifactBase}.png`),
        },
        firstCommentKeys: r.structureAnalysis.firstCommentKeys,
        allCommentKeysUnique: r.structureAnalysis.allCommentKeysUnique,
        hasId: r.structureAnalysis.hasId,
        hasCommentId: r.structureAnalysis.hasCommentId,
        hasAuthor: r.structureAnalysis.hasAuthor,
        hasCreatedAt: r.structureAnalysis.hasCreatedAt,
        hasParentId: r.structureAnalysis.hasParentId,
        hasParentCommentId: r.structureAnalysis.hasParentId,
        hasReplyTo: r.structureAnalysis.hasReplyTo,
        hasResolved: r.structureAnalysis.hasResolved,
        hasIsResolved: r.structureAnalysis.hasIsResolved,
        hasClosed: r.structureAnalysis.hasClosed,
        hasStatus: r.structureAnalysis.hasStatus,
        hasReplies: r.structureAnalysis.hasReplies,
        hasThread: r.structureAnalysis.hasThread,
        hasChildren: r.structureAnalysis.hasChildren,
        firstCommentFull: r.structureAnalysis.firstCommentFull,
        canDetermineQuestionAnswerWithoutHeuristics: assessment.exactRulePossible,
        structureVerdict: assessment.verdict,
        rawTaskCommentsProposal: assessment.rawTaskCommentsProposal,
      };
    });

    const anyComments = tasks.some((t) => t.commentsCount > 0);
    const summary = {
      generatedAt: new Date().toISOString(),
      boardId,
      boardUrl: boardId !== "unknown" ? `https://apptask.ru/c/7/board/${boardId}` : null,
      taskUrls,
      tasksChecked: tasks.length,
      tasksWithComments: tasks.filter((t) => t.commentsCount > 0).length,
      tasks,
      overall: {
        commentListNonEmpty: anyComments,
        exactQuestionAnswerRulePossible: tasks.some(
          (t) => t.canDetermineQuestionAnswerWithoutHeuristics,
        ),
        note: anyComments
          ? "Не внедрять правило в engine до согласования RawTask.comments по structureVerdict"
          : "На указанных URL commentList[] пуст или API не перехвачен",
      },
    };

    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n=== Summary ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nSaved: ${summaryPath}`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
