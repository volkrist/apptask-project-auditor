import fs from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { createLogger } from "./logger.js";
import { boardUrlPattern, parseBoardId } from "./urls.js";

const log = createLogger("board");

export const BOARD_READY_TIMEOUT_MS = 180_000;
const GOTO_TIMEOUT_MS = 30_000;
const DEBUG_DIR = path.join("output", "debug");

export const BOARD_COLUMN_LABELS = [
  "Новая задача",
  "В процессе",
  "На проверке",
  "Завершено",
] as const;

export type BoardDiagnostics = {
  url: string;
  ready: boolean;
  matchedColumn?: string;
  bodyTextLength: number;
  failedRequests: Array<{ method: string; url: string; error?: string }>;
  consoleErrors: string[];
  artifacts: {
    screenshot?: string;
    html?: string;
    network?: string;
  };
};

export class BoardNotReadyError extends Error {
  constructor(
    message: string,
    readonly diagnostics: BoardDiagnostics,
  ) {
    super(message);
    this.name = "BoardNotReadyError";
  }
}

function attachPageCollectors(page: Page) {
  const failedRequests: BoardDiagnostics["failedRequests"] = [];
  const consoleErrors: string[] = [];
  const responses: Array<{ status: number; method: string; url: string }> = [];

  const onFailed = (r: {
    method: () => string;
    url: () => string;
    failure: () => { errorText?: string } | null;
  }) => {
    failedRequests.push({
      method: r.method(),
      url: r.url(),
      error: r.failure()?.errorText,
    });
  };

  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };

  const onResponse = (r: {
    status: () => number;
    request: () => { method: () => string };
    url: () => string;
  }) => {
    responses.push({
      status: r.status(),
      method: r.request().method(),
      url: r.url(),
    });
    if (responses.length > 400) responses.shift();
  };

  page.on("requestfailed", onFailed);
  page.on("console", onConsole);
  page.on("response", onResponse);

  return {
    failedRequests,
    consoleErrors,
    networkSnapshot: () => ({
      savedAt: new Date().toISOString(),
      failedRequests,
      consoleErrors,
      lastResponses: responses.slice(-30),
    }),
    detach: () => {
      page.off("requestfailed", onFailed);
      page.off("console", onConsole);
      page.off("response", onResponse);
    },
  };
}

async function saveFailureArtifacts(
  page: Page,
  networkLog: object,
): Promise<BoardDiagnostics["artifacts"]> {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const artifacts = {
    screenshot: path.join(DEBUG_DIR, "board-fail.png"),
    html: path.join(DEBUG_DIR, "board-snapshot.html"),
    network: path.join(DEBUG_DIR, "board-network.json"),
  };

  try {
    await page.screenshot({
      path: artifacts.screenshot,
      fullPage: true,
      timeout: 15_000,
      animations: "disabled",
    });
  } catch (e) {
    log.warn(`screenshot: ${e instanceof Error ? e.message : e}`);
  }

  try {
    fs.writeFileSync(artifacts.html, await page.content(), "utf8");
  } catch (e) {
    log.warn(`html: ${e instanceof Error ? e.message : e}`);
  }

  fs.writeFileSync(
    artifacts.network,
    JSON.stringify(networkLog, null, 2),
    "utf8",
  );

  return artifacts;
}

/** Kanban column title — scoped to avoid hidden `.parent-overlay` duplicates. */
const columnTitle = (page: Page, label: string) =>
  page
    .locator("p.project-states-content__title")
    .getByText(label, { exact: true })
    .first();

const columnLocators = (page: Page) => ({
  newTask: columnTitle(page, "Новая задача"),
  inProgress: columnTitle(page, "В процессе"),
  inReview: columnTitle(page, "На проверке"),
  done: columnTitle(page, "Завершено"),
});

/** All four Kanban column headers visible. */
export async function waitForBoardColumns(
  page: Page,
  timeoutMs = BOARD_READY_TIMEOUT_MS,
): Promise<string> {
  const cols = columnLocators(page);

  await Promise.all([
    cols.newTask.waitFor({ state: "visible", timeout: timeoutMs }),
    cols.inProgress.waitFor({ state: "visible", timeout: timeoutMs }),
    cols.inReview.waitFor({ state: "visible", timeout: timeoutMs }),
    cols.done.waitFor({ state: "visible", timeout: timeoutMs }),
  ]);

  return BOARD_COLUMN_LABELS.join(" | ");
}

export async function openBoardWithReadiness(
  page: Page,
  boardUrl: string,
): Promise<BoardDiagnostics> {
  const boardId = parseBoardId(boardUrl);
  if (!boardId) throw new Error(`Invalid board URL: ${boardUrl}`);

  const collectors = attachPageCollectors(page);

  try {
    log.info(`goto ${boardUrl}`);
    await page.goto(boardUrl, {
      waitUntil: "commit",
      timeout: GOTO_TIMEOUT_MS,
    });

    await expect(page).toHaveURL(boardUrlPattern(boardId), { timeout: 15_000 });

    if (page.url().includes("/login")) {
      throw new Error(
        "Redirected to /login — log in manually: npm run auth:profile",
      );
    }

    const bodyTextLength = (await page.locator("body").innerText()).length;
    log.info(`url ok, bodyLen=${bodyTextLength}`);

    const matchedColumn = await waitForBoardColumns(page);
    log.info(`board ready — matched: "${matchedColumn}"`);

    return {
      url: page.url(),
      ready: true,
      matchedColumn,
      bodyTextLength,
      failedRequests: collectors.failedRequests,
      consoleErrors: collectors.consoleErrors,
      artifacts: {},
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const artifacts = await saveFailureArtifacts(
      page,
      collectors.networkSnapshot(),
    );

    const diagnostics: BoardDiagnostics = {
      url: page.url(),
      ready: false,
      bodyTextLength: await page
        .locator("body")
        .innerText()
        .then((t) => t.length)
        .catch(() => 0),
      failedRequests: collectors.failedRequests,
      consoleErrors: collectors.consoleErrors,
      artifacts,
    };

    log.error(message);
    for (const f of diagnostics.failedRequests) {
      log.error(`  FAILED ${f.method} ${f.url} — ${f.error ?? ""}`);
    }
    for (const c of diagnostics.consoleErrors) {
      log.error(`  CONSOLE ${c}`);
    }

    throw new BoardNotReadyError(message, diagnostics);
  } finally {
    collectors.detach();
  }
}
