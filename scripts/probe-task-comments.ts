/**
 * Diagnostic: comments DOM + network when opening one task card.
 * Does not change RawTask, rules, or audit flow.
 *
 * Run: npx tsx scripts/probe-task-comments.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import {
  attachNetworkCollector,
  type NetworkEntry,
} from "../src/adapters/apptask/board-debug.js";
import { closeTaskCard, openTaskCard } from "../src/adapters/apptask/card.js";
import { collectTaskRefsFromBoard } from "../src/adapters/apptask/collect.js";
import { TASK_MODAL_SELECTORS } from "../src/adapters/apptask/selectors.js";
import { parseBoardId } from "../src/adapters/apptask/urls.js";

const BOARD_URL =
  process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/445";

const DEBUG_DIR = path.join("output", "debug");
const OUT_HTML = path.join(DEBUG_DIR, "task-card-comments.html");
const OUT_NETWORK = path.join(DEBUG_DIR, "task-card-network.json");
const OUT_SAMPLE = path.join(DEBUG_DIR, "task-card-comments-sample.json");

const API_URL_HINTS = [
  "comment",
  "activity",
  "history",
  "feed",
  "message",
  "discuss",
  "chat",
  "note",
  "task/",
  "board/",
  "card/",
];

type CapturedResponse = NetworkEntry & {
  bodyKind?: "json" | "text" | "empty" | "skipped";
  jsonKeys?: string[];
  jsonSample?: unknown;
  bodyPreview?: string;
};

type DomCommentProbe = {
  modalFound: boolean;
  modalHtmlLength: number;
  commentLikeSelectors: Array<{ selector: string; count: number }>;
  commentLikeClassNames: string[];
  commentLikeTextSnippets: string[];
  dataAttributes: string[];
  innerStructureSample: unknown;
};

function ensureDebugDir(): void {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function urlLooksRelevant(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("apptask.ru") ||
    lower.includes("host2201.apptask.ru") ||
    API_URL_HINTS.some((hint) => lower.includes(hint))
  );
}

function collectJsonKeys(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return collectJsonKeys(value[0], `${prefix}[]`, depth + 1);
  }
  if (typeof value !== "object") return [];
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    keys.push(pathKey);
    keys.push(...collectJsonKeys(child, pathKey, depth + 1));
  }
  return keys;
}

function findCommentFieldsInJson(
  value: unknown,
  path = "",
  hits: Array<{ path: string; value: unknown }> = [],
): Array<{ path: string; value: unknown }> {
  if (value === null || value === undefined || hits.length > 80) return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findCommentFieldsInJson(item, `${path}[${index}]`, hits),
    );
    return hits;
  }
  if (typeof value !== "object") return hits;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    const keyLower = key.toLowerCase();
    if (
      /comment|reply|parent|resolved|author|created|activity|history|message/i.test(
        key,
      )
    ) {
      hits.push({ path: childPath, value: child });
    }
    findCommentFieldsInJson(child, childPath, hits);
  }
  return hits;
}

function attachDeepNetworkCollector(page: Page): {
  getAll: () => CapturedResponse[];
  stop: () => void;
} {
  const entries: CapturedResponse[] = [];

  const onResponse = async (response: Response) => {
    const req = response.request();
    const url = response.url();
    if (!urlLooksRelevant(url)) return;

    const entry: CapturedResponse = {
      ts: new Date().toISOString(),
      method: req.method(),
      url,
      status: response.status(),
      resourceType: req.resourceType(),
      failed: false,
    };

    const contentType = response.headers()["content-type"] ?? "";
    if (
      req.resourceType() === "xhr" ||
      req.resourceType() === "fetch" ||
      contentType.includes("json")
    ) {
      try {
        const text = await response.text();
        if (!text.trim()) {
          entry.bodyKind = "empty";
        } else if (contentType.includes("json") || text.trim().startsWith("{")) {
          const parsed = JSON.parse(text) as unknown;
          entry.bodyKind = "json";
          entry.jsonKeys = [...new Set(collectJsonKeys(parsed))].slice(0, 120);
          entry.jsonSample = parsed;
          entry.bodyPreview = text.slice(0, 4000);
        } else {
          entry.bodyKind = "text";
          entry.bodyPreview = text.slice(0, 2000);
        }
      } catch {
        entry.bodyKind = "skipped";
      }
    } else {
      entry.bodyKind = "skipped";
    }

    entries.push(entry);
  };

  const wrapper = (response: Response) => {
    void onResponse(response);
  };
  page.on("response", wrapper);

  return {
    getAll: () => [...entries],
    stop: () => {
      page.off("response", wrapper);
    },
  };
}

async function probeDomComments(page: Page): Promise<DomCommentProbe> {
  const modal = page.locator(TASK_MODAL_SELECTORS.root);
  const modalFound = await modal.count().then((c) => c > 0);

  const probe = await page.evaluate(() => {
    const modalEl = document.querySelector(".modal-card.task-details");
    if (!modalEl) {
      return {
        modalFound: false,
        modalHtmlLength: 0,
        commentLikeSelectors: [] as Array<{ selector: string; count: number }>,
        commentLikeClassNames: [] as string[],
        commentLikeTextSnippets: [] as string[],
        dataAttributes: [] as string[],
        innerStructureSample: null,
      };
    }

    const selectorCandidates = [
      ".modal-card-comments",
      ".task-comments",
      ".comments",
      ".comment",
      "[class*='comment']",
      "[class*='Comment']",
      "[id*='comment']",
      ".activity",
      "[class*='activity']",
      ".history",
      "[class*='history']",
      ".modal-card-content__comments",
      ".modal-card-body__comments",
    ];

    const commentLikeSelectors = selectorCandidates
      .map((selector) => ({
        selector,
        count: modalEl.querySelectorAll(selector).length,
      }))
      .filter((row) => row.count > 0);

    const classNames = new Set<string>();
    modalEl.querySelectorAll("*").forEach((el) => {
      for (const cls of el.classList) {
        if (/comment|activity|history|reply|discuss/i.test(cls)) {
          classNames.add(cls);
        }
      }
    });

    const textSnippets: string[] = [];
    modalEl.querySelectorAll("*").forEach((el) => {
      const text = (el as HTMLElement).innerText?.trim();
      if (
        text &&
        text.length < 200 &&
        /коммент|ответ|вопрос|уточн/i.test(text)
      ) {
        textSnippets.push(text);
      }
    });

    const dataAttributes = new Set<string>();
    modalEl.querySelectorAll("*").forEach((el) => {
      for (const attr of el.attributes) {
        if (/comment|reply|parent|resolved|author/i.test(attr.name)) {
          dataAttributes.add(`${attr.name}=${attr.value.slice(0, 80)}`);
        }
      }
    });

    const commentBlocks = Array.from(
      modalEl.querySelectorAll("[class*='comment'], .comments, .activity"),
    )
      .slice(0, 5)
      .map((el) => ({
        tag: el.tagName,
        className: el.className,
        text: (el as HTMLElement).innerText?.trim().slice(0, 500) ?? "",
        html: el.outerHTML.slice(0, 1500),
      }));

    return {
      modalFound: true,
      modalHtmlLength: modalEl.outerHTML.length,
      commentLikeSelectors,
      commentLikeClassNames: [...classNames].slice(0, 40),
      commentLikeTextSnippets: [...new Set(textSnippets)].slice(0, 30),
      dataAttributes: [...dataAttributes].slice(0, 40),
      innerStructureSample: commentBlocks,
    };
  });

  return { ...probe, modalFound: probe.modalFound && modalFound };
}

async function main(): Promise<void> {
  ensureDebugDir();
  assertProfileExists();

  const boardId = parseBoardId(BOARD_URL);
  if (!boardId) throw new Error(`Invalid board URL: ${BOARD_URL}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const shallowNet = attachNetworkCollector(page);
  const deepNet = attachDeepNetworkCollector(page);

  try {
    console.log("Opening board:", BOARD_URL);
    await openBoardWithReadiness(page, BOARD_URL);

    const refs = await collectTaskRefsFromBoard(page);
    if (refs.length === 0) throw new Error("No task cards on board");

    const ref = refs[0]!;
    console.log("Opening first card:", JSON.stringify(ref));

    const opened = await openTaskCard(page, ref, BOARD_URL, boardId);
    if (!opened.ok) throw new Error(opened.reason);

    const modal = page.locator(TASK_MODAL_SELECTORS.root);
    await modal.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2000);

    const domProbe = await probeDomComments(page);
    const modalHtml = await modal.evaluate((el) => el.outerHTML).catch(() => "");
    fs.writeFileSync(OUT_HTML, modalHtml, "utf8");

    const allResponses = deepNet.getAll();
    const jsonResponses = allResponses.filter((r) => r.bodyKind === "json");
    const commentFieldHits = jsonResponses.flatMap((r) =>
      findCommentFieldsInJson(r.jsonSample).map((hit) => ({
        url: r.url,
        method: r.method,
        ...hit,
      })),
    );

    const networkReport = {
      savedAt: new Date().toISOString(),
      boardUrl: BOARD_URL,
      cardUrl: page.url(),
      taskRef: ref,
      shallowFailed: shallowNet.getFailed(),
      shallowLast: shallowNet.getLast(30),
      capturedCount: allResponses.length,
      jsonResponseCount: jsonResponses.length,
      relevantJsonUrls: jsonResponses.map((r) => ({
        method: r.method,
        url: r.url,
        status: r.status,
        jsonKeys: r.jsonKeys?.slice(0, 40),
      })),
      commentFieldHits: commentFieldHits.slice(0, 60),
      allCaptured: allResponses,
    };

    fs.writeFileSync(OUT_NETWORK, JSON.stringify(networkReport, null, 2), "utf8");

    const proposedFields = {
      investigation: "AppTask task card — comments probe (diagnostic only)",
      dom: domProbe,
      networkSummary: {
        jsonResponseCount: jsonResponses.length,
        commentFieldHitsCount: commentFieldHits.length,
      },
      detectedInApi: analyzeApiStructure(jsonResponses),
      proposedRawTaskCommentsFormat: null as unknown,
      conclusion: "",
    };

    const detected = proposedFields.detectedInApi as ReturnType<
      typeof analyzeApiStructure
    >;
    if (detected.hasStructuredComments) {
      proposedFields.proposedRawTaskCommentsFormat = {
        note: "Proposal only — not implemented without approval",
        type: "TaskComment",
        fields: {
          commentId: detected.sampleFields.commentId ?? "string | null",
          parentCommentId: detected.sampleFields.parentCommentId ?? "string | null",
          createdAt: detected.sampleFields.createdAt ?? "string | null",
          author: detected.sampleFields.author ?? "string | null",
          text: detected.sampleFields.text ?? "string | null",
          isResolved: detected.sampleFields.isResolved ?? "boolean | null",
          isQuestion: detected.sampleFields.isQuestion ?? "boolean | null",
          isReply: "parentCommentId != null",
        },
        example: detected.sampleRecord,
      };
      proposedFields.conclusion =
        "Non-empty commentList item captured from get_task_comments. See proposed format above.";
    } else if (detected.hasCommentApiEndpoint) {
      proposedFields.conclusion =
        "API endpoint board/get_task_comments exists (data.commentList), but captured commentList was empty and DOM had no rendered comments. Item-level fields (commentId, parentCommentId, resolved, question) were not observed. Exact «all questions answered» rule is not feasible without non-empty comment samples or explicit question-reply status in AppTask.";
    } else {
      proposedFields.conclusion =
        "No get_task_comments response captured. Exact «all questions answered» rule is not feasible without structured comment data from AppTask.";
    }

    fs.writeFileSync(OUT_SAMPLE, JSON.stringify(proposedFields, null, 2), "utf8");

    console.log("\n--- DOM ---");
    console.log(JSON.stringify(domProbe, null, 2));
    console.log("\n--- Network summary ---");
    console.log(
      `captured=${allResponses.length} json=${jsonResponses.length} fieldHits=${commentFieldHits.length}`,
    );
    console.log("Saved:", OUT_HTML, OUT_NETWORK, OUT_SAMPLE);

    await closeTaskCard(page);
  } finally {
    deepNet.stop();
    shallowNet.stop();
    await context.close();
  }
}

function extractCommentListItem(
  jsonSample: unknown,
): Record<string, unknown> | null {
  if (!jsonSample || typeof jsonSample !== "object") return null;
  const root = jsonSample as Record<string, unknown>;
  const data = root.data;
  if (!data || typeof data !== "object") return null;
  const commentList = (data as Record<string, unknown>).commentList;
  if (!Array.isArray(commentList) || commentList.length === 0) return null;
  const first = commentList[0];
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : null;
}

function mapCommentItemFields(
  item: Record<string, unknown>,
): Record<string, string | undefined> {
  const keys = Object.keys(item).map((k) => k.toLowerCase());
  const findKey = (re: RegExp) =>
    Object.keys(item).find((k) => re.test(k.toLowerCase()));

  return {
    commentId: findKey(/^id$|commentid/),
    parentCommentId: findKey(/parentcomment|parentid|replyto|parent_id/),
    createdAt: findKey(/created|createtime|postdate|processeddate|date/),
    author: findKey(/author|creator|userid|user/),
    text: findKey(/text|body|content|message/),
    isResolved: findKey(/resolved|isresolved|closed|processed/),
    isQuestion: findKey(/question|isquestion/),
  };
}

function analyzeApiStructure(
  jsonResponses: CapturedResponse[],
): {
  hasStructuredComments: boolean;
  hasCommentApiEndpoint: boolean;
  commentListEmpty: boolean;
  sampleFields: Record<string, string | undefined>;
  sampleRecord: unknown;
  getTaskCommentsResponses: Array<{ url: string; commentListLength: number }>;
} {
  const sampleFields: Record<string, string | undefined> = {};
  let sampleRecord: unknown = null;
  let hasCommentApiEndpoint = false;
  let commentListEmpty = true;
  const getTaskCommentsResponses: Array<{
    url: string;
    commentListLength: number;
  }> = [];

  for (const response of jsonResponses) {
    if (!response.url.includes("get_task_comments")) continue;
    hasCommentApiEndpoint = true;
    const item = extractCommentListItem(response.jsonSample);
    const data = (response.jsonSample as Record<string, unknown> | undefined)
      ?.data as Record<string, unknown> | undefined;
    const len = Array.isArray(data?.commentList) ? data.commentList.length : 0;
    getTaskCommentsResponses.push({ url: response.url, commentListLength: len });
    if (len > 0) commentListEmpty = false;
    if (item && !sampleRecord) {
      sampleRecord = item;
      Object.assign(sampleFields, mapCommentItemFields(item));
    }
  }

  const hasStructuredComments = Boolean(sampleRecord);

  return {
    hasStructuredComments,
    hasCommentApiEndpoint,
    commentListEmpty,
    sampleFields,
    sampleRecord,
    getTaskCommentsResponses,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
