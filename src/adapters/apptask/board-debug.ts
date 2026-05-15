import fs from "node:fs";
import path from "node:path";
import type { Page, Response } from "@playwright/test";
import { createLogger } from "./logger.js";
import { boardUrlPattern, parseBoardId } from "./urls.js";

const log = createLogger("board-debug");

export const BOARD_READY_TIMEOUT_MS = 90_000;
const GOTO_TIMEOUT_MS = 30_000;
const DEBUG_DIR = path.join("output", "debug");

/** Kanban column labels — stable readiness signal per manual UI check */
export const BOARD_COLUMN_LABELS = [
  "Новая задача",
  "В процессе",
  "На проверке",
  "Завершено",
] as const;

export type NetworkEntry = {
  ts: string;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  failed: boolean;
  failureText?: string;
};

export type PageSnapshot = {
  ts: string;
  label: string;
  url: string;
  readyState: string;
  bodyTextLength: number;
  scriptCount: number;
  linkCount: number;
  imgCount: number;
  columnLabelsFound: string[];
};

export type BoardDiagnostics = {
  boardUrl: string;
  boardId: string;
  finalUrl: string;
  ready: boolean;
  readinessSignal?: string;
  snapshots: PageSnapshot[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: NetworkEntry[];
  lastResponses: NetworkEntry[];
  artifacts: {
    screenshot?: string;
    html?: string;
    network?: string;
  };
};

export class BoardDebugError extends Error {
  constructor(
    message: string,
    readonly diagnostics: BoardDiagnostics,
  ) {
    super(message);
    this.name = "BoardDebugError";
  }
}

function ensureDebugDir(): void {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

export function attachNetworkCollector(page: Page): {
  getFailed: () => NetworkEntry[];
  getLast: (n: number) => NetworkEntry[];
  stop: () => void;
} {
  const responses: NetworkEntry[] = [];
  const failed: NetworkEntry[] = [];

  const onResponse = (response: Response) => {
    const req = response.request();
    const entry: NetworkEntry = {
      ts: new Date().toISOString(),
      method: req.method(),
      url: response.url(),
      status: response.status(),
      resourceType: req.resourceType(),
      failed: false,
    };
    responses.push(entry);
    if (responses.length > 200) responses.shift();
  };

  const onRequestFailed = (request: {
    method: () => string;
    url: () => string;
    resourceType: () => string;
    failure: () => { errorText?: string } | null;
  }) => {
    failed.push({
      ts: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      status: 0,
      resourceType: request.resourceType(),
      failed: true,
      failureText: request.failure()?.errorText,
    });
  };

  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);

  return {
    getFailed: () => [...failed],
    getLast: (n: number) => responses.slice(-n),
    stop: () => {
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
    },
  };
}

export function attachErrorCollectors(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      log.warn(`console.error: ${msg.text().slice(0, 200)}`);
    }
  });

  page.on("pageerror", (err) => {
    const text = err.message;
    pageErrors.push(text);
    log.error(`pageerror: ${text.slice(0, 200)}`);
  });

  return { consoleErrors, pageErrors };
}

export async function capturePageSnapshot(
  page: Page,
  label: string,
): Promise<PageSnapshot> {
  const data = await page.evaluate((labels) => {
    const bodyText = document.body?.innerText?.trim() ?? "";
    const found = labels.filter((l) => bodyText.includes(l));
    return {
      readyState: document.readyState,
      bodyTextLength: bodyText.length,
      scriptCount: document.querySelectorAll("script").length,
      linkCount: document.querySelectorAll("link").length,
      imgCount: document.querySelectorAll("img").length,
      columnLabelsFound: found,
    };
  }, [...BOARD_COLUMN_LABELS]);

  const snap: PageSnapshot = {
    ts: new Date().toISOString(),
    label,
    url: page.url(),
    ...data,
  };

  log.info(
    `snapshot [${label}] url=${snap.url} readyState=${snap.readyState} ` +
      `bodyLen=${snap.bodyTextLength} scripts=${snap.scriptCount} ` +
      `columns=[${snap.columnLabelsFound.join(", ")}]`,
  );

  return snap;
}

async function saveFailureArtifacts(
  page: Page,
  network: NetworkEntry[],
  failedRequests: NetworkEntry[],
  lastResponses: NetworkEntry[],
): Promise<BoardDiagnostics["artifacts"]> {
  ensureDebugDir();

  const artifacts: BoardDiagnostics["artifacts"] = {
    screenshot: path.join(DEBUG_DIR, "board-fail.png"),
    html: path.join(DEBUG_DIR, "board-snapshot.html"),
    network: path.join(DEBUG_DIR, "board-network.json"),
  };

  try {
    const shotPath = artifacts.screenshot ?? path.join(DEBUG_DIR, "board-fail.png");
    await page.screenshot({
      path: shotPath,
      fullPage: false,
      timeout: 10_000,
      animations: "disabled",
    });
  } catch (e) {
    log.warn(`screenshot failed: ${e instanceof Error ? e.message : e}`);
  }

  try {
    const html = await page.content();
    const htmlPath = artifacts.html ?? path.join(DEBUG_DIR, "board-snapshot.html");
    fs.writeFileSync(htmlPath, html, "utf8");
  } catch (e) {
    log.warn(`html snapshot failed: ${e instanceof Error ? e.message : e}`);
  }

  const networkPath = artifacts.network ?? path.join(DEBUG_DIR, "board-network.json");
  fs.writeFileSync(
    networkPath,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        failedRequests,
        lastResponses,
        allCaptured: network,
      },
      null,
      2,
    ),
    "utf8",
  );

  log.info(`artifacts: ${JSON.stringify(artifacts)}`);
  return artifacts;
}

/** API hosts seen in Playwright trace (Blazor WASM boot) */
const BOARD_API_PATTERNS = [
  /validate_session/i,
  /get_cache/i,
  /get_user_company_linq/i,
  /get_host_linq/i,
  /login_with_crm/i,
  /synchub\/negotiate/i,
  /\/board\/\d+/i,
  /task|card|kanban|column|category/i,
];

function isStaticAsset(url: string): boolean {
  return (
    /\.(css|js|dll|wasm|dat|blat|png|jpg|svg|woff2?)(\?|$)/i.test(url) ||
    url.includes("workaround-gradient") ||
    url.includes("_framework/") ||
    url.includes("fonts.googleapis.com")
  );
}

function isBoardDataResponse(url: string): boolean {
  if (!/apptask\.ru/i.test(url)) return false;
  if (isStaticAsset(url)) return false;
  return BOARD_API_PATTERNS.some((p) => p.test(url));
}

async function waitForBoardReady(
  page: Page,
  boardId: string,
  onSnapshot: (snap: PageSnapshot) => void,
): Promise<string> {
  const columnPattern = new RegExp(
    BOARD_COLUMN_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  );

  const columnLocator = page.getByText(columnPattern).first();

  const waitColumns = columnLocator
    .waitFor({ state: "visible", timeout: BOARD_READY_TIMEOUT_MS })
    .then(async () => {
      const text = (await columnLocator.textContent())?.trim() ?? "column";
      return `column-text:${text}`;
    });

  const waitValidateSession = page
    .waitForResponse(
      (r) => r.url().includes("validate_session") && r.status() === 200,
      { timeout: BOARD_READY_TIMEOUT_MS },
    )
    .then((r) => `api:validate_session ${r.url()}`);

  const waitGetCache = page
    .waitForResponse(
      (r) => r.url().includes("get_cache") && r.status() === 200,
      { timeout: BOARD_READY_TIMEOUT_MS },
    )
    .then((r) => `api:get_cache ${r.url()}`);

  const waitBlazorBoot = page
    .waitForResponse(
      (r) => r.url().includes("blazor.boot.json") && r.status() === 200,
      { timeout: BOARD_READY_TIMEOUT_MS },
    )
    .then(() => "blazor-boot-loaded");

  let tickerDone = false;
  const maxTicks = Math.floor(BOARD_READY_TIMEOUT_MS / 10_000);
  const snapshotTicker = (async () => {
    for (let i = 1; i <= maxTicks && !tickerDone; i++) {
      await page.waitForTimeout(10_000);
      if (tickerDone) break;
      onSnapshot(await capturePageSnapshot(page, `tick-${i * 10}s`));
    }
  })();

  try {
    // Priority: column labels (best) > session API > cache API
    const signal = await Promise.race([
      waitColumns,
      waitValidateSession,
      waitGetCache,
    ]);
    tickerDone = true;
    return signal;
  } catch {
    throw new Error("No readiness signal within 90s");
  } finally {
    tickerDone = true;
    await snapshotTicker.catch(() => {});
  }
}

export async function runBoardDiagnostics(
  page: Page,
  boardUrl: string,
): Promise<BoardDiagnostics> {
  const boardId = parseBoardId(boardUrl);
  if (!boardId) throw new Error(`Invalid board URL: ${boardUrl}`);

  ensureDebugDir();

  const network = attachNetworkCollector(page);
  const { consoleErrors, pageErrors } = attachErrorCollectors(page);
  const snapshots: PageSnapshot[] = [];

  const diagnostics: BoardDiagnostics = {
    boardUrl,
    boardId,
    finalUrl: boardUrl,
    ready: false,
    snapshots,
    consoleErrors,
    pageErrors,
    failedRequests: [],
    lastResponses: [],
    artifacts: {},
  };

  try {
    log.info(`goto ${boardUrl}`);
    await page.goto(boardUrl, {
      waitUntil: "commit",
      timeout: GOTO_TIMEOUT_MS,
    });

    snapshots.push(await capturePageSnapshot(page, "after-goto"));

    const url = page.url();
    diagnostics.finalUrl = url;
    log.info(`page.url() = ${url}`);

    if (url.includes("/login")) {
      throw new Error("Redirected to /login — run: npm run auth:login");
    }
    if (!boardUrlPattern(boardId).test(url)) {
      throw new Error(`Unexpected URL (expected board ${boardId}): ${url}`);
    }

    const loginVisible = await page
      .locator("#Input_Email")
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (loginVisible) {
      throw new Error('Login form visible (#Input_Email) — session expired');
    }

    const readinessSignal = await waitForBoardReady(page, boardId, (snap) => {
      snapshots.push(snap);
    });

    diagnostics.ready = true;
    diagnostics.readinessSignal = readinessSignal;
    snapshots.push(await capturePageSnapshot(page, "ready"));

    log.info(`Board ready via: ${readinessSignal}`);

    return diagnostics;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Board not ready: ${message}`);

    snapshots.push(await capturePageSnapshot(page, "on-fail").catch(() => ({
      ts: new Date().toISOString(),
      label: "on-fail",
      url: page.url(),
      readyState: "unknown",
      bodyTextLength: -1,
      scriptCount: -1,
      linkCount: -1,
      imgCount: -1,
      columnLabelsFound: [],
    })));

    diagnostics.failedRequests = network.getFailed();
    diagnostics.lastResponses = network.getLast(20);

    log.info(`failed requests: ${diagnostics.failedRequests.length}`);
    for (const f of diagnostics.failedRequests) {
      log.warn(`  FAILED ${f.method} ${f.url} — ${f.failureText ?? "unknown"}`);
    }

    log.info("last 20 responses:");
    for (const r of diagnostics.lastResponses) {
      log.info(`  ${r.status} ${r.method} ${r.url.slice(0, 120)}`);
    }

    diagnostics.artifacts = await saveFailureArtifacts(
      page,
      network.getLast(200),
      diagnostics.failedRequests,
      diagnostics.lastResponses,
    );

    throw new BoardDebugError(message, diagnostics);
  } finally {
    network.stop();
  }
}
