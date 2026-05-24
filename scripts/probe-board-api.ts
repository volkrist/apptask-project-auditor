/**
 * Diagnostic: board/task internal APIs (XHR/fetch) for API-first collector research.
 * Does not change audit, parser, or rules.
 *
 * Run:
 *   npx tsx scripts/probe-board-api.ts --board-url "https://apptask.ru/c/7/board/54"
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import { expandAllCategories } from "../src/adapters/apptask/collect.js";
import { BOARD_SELECTORS, TASK_MODAL_SELECTORS } from "../src/adapters/apptask/selectors.js";
import { parseBoardId } from "../src/adapters/apptask/urls.js";

const OUT_DIR = path.join("output", "debug", "board-api");
const OUT_NETWORK = path.join(OUT_DIR, "network.json");
const OUT_TASKS = path.join(OUT_DIR, "tasks-api-response.json");
const OUT_DETAILS = path.join(OUT_DIR, "task-details-api-response.json");
const OUT_SUMMARY = path.join(OUT_DIR, "summary.json");

const DEFAULT_BOARD =
  process.env.APPTASK_BOARD_URL ?? "https://apptask.ru/c/7/board/54";

const TASK_KEYWORDS = [
  "task",
  "tasks",
  "tasklist",
  "boardtask",
  "assignee",
  "executor",
  "deadline",
  "duedate",
  "status",
  "stage",
  "priority",
  "tags",
  "description",
  "attachment",
  "links",
] as const;

/** RawTask fields we want to compare against API coverage. */
const RAW_TASK_FIELDS = [
  "id",
  "url",
  "title",
  "descriptionText",
  "createdAt",
  "startDate",
  "dueDate",
  "priority",
  "status",
  "tags",
  "creator",
  "assignees",
  "assigneeRefs",
  "category",
  "stage",
  "plannedTime",
  "actualTime",
  "links",
  "attachments",
  "comments",
] as const;

type RawTaskField = (typeof RAW_TASK_FIELDS)[number];

/** Heuristic: API JSON key/path fragment → RawTask field(s). */
const API_KEY_TO_RAW_TASK: Array<{ pattern: RegExp; fields: RawTaskField[] }> = [
  { pattern: /^id$|taskid|projectid/i, fields: ["id"] },
  { pattern: /title|name|subject/i, fields: ["title"] },
  { pattern: /description|content|body|text/i, fields: ["descriptionText"] },
  { pattern: /createdat|createtime|created/i, fields: ["createdAt"] },
  { pattern: /startdate|datestart|start_time/i, fields: ["startDate"] },
  { pattern: /duedate|deadline|dateend|enddate|finish/i, fields: ["dueDate"] },
  { pattern: /priority/i, fields: ["priority"] },
  { pattern: /status|column|state(?!id)/i, fields: ["status"] },
  { pattern: /stage|step/i, fields: ["stage"] },
  { pattern: /tag/i, fields: ["tags"] },
  { pattern: /creator|author|owner/i, fields: ["creator"] },
  { pattern: /assignee|executor|responsible|member/i, fields: ["assignees", "assigneeRefs"] },
  { pattern: /category|section|group/i, fields: ["category"] },
  { pattern: /planned|estimate|budget.*time/i, fields: ["plannedTime"] },
  { pattern: /actual.*time|spent|tracked/i, fields: ["actualTime"] },
  { pattern: /link|url|href/i, fields: ["links"] },
  { pattern: /attachment|file/i, fields: ["attachments"] },
  { pattern: /comment/i, fields: ["comments"] },
];

type CapturedResponse = {
  ts: string;
  phase: "board" | "task_details";
  method: string;
  url: string;
  status: number;
  resourceType: string;
  requestPostData?: string;
  bodyKind?: "json" | "text" | "empty" | "skipped";
  jsonKeys?: string[];
  jsonSample?: unknown;
  bodyPreview?: string;
  taskKeywordHits?: string[];
};

function parseCli(argv: string[]): {
  boardUrl: string;
  sampleTaskId: string | null;
  skipDetails: boolean;
} {
  let boardUrl = DEFAULT_BOARD;
  let sampleTaskId: string | null = "5765";
  let skipDetails = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === "--board-url" && next) {
      boardUrl = next;
      i++;
    } else if (arg === "--sample-task-id" && next) {
      sampleTaskId = next;
      i++;
    } else if (arg === "--skip-details") {
      skipDetails = true;
    }
  }

  return { boardUrl, sampleTaskId, skipDetails };
}

function urlLooksRelevant(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("apptask.ru") ||
    lower.includes("host2201") ||
    /\/board\//i.test(url) ||
    /task|project|card|kanban/i.test(url)
  );
}

function collectJsonKeys(value: unknown, prefix = "", depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return [];
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

function findTaskKeywordHits(
  value: unknown,
  path = "",
  hits = new Set<string>(),
  depth = 0,
): Set<string> {
  if (depth > 8 || value === null || value === undefined) return hits;
  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, 3); i++) {
      findTaskKeywordHits(value[i], `${path}[${i}]`, hits, depth + 1);
    }
    return hits;
  }
  if (typeof value !== "object") return hits;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    for (const kw of TASK_KEYWORDS) {
      if (keyLower.includes(kw)) hits.add(kw);
    }
    findTaskKeywordHits(child, path ? `${path}.${key}` : key, hits, depth + 1);
  }
  return hits;
}

function isBoardListEndpoint(url: string): boolean {
  return /\/board\/get$/i.test(url.split("?")[0]!);
}

function isTaskListEndpoint(url: string): boolean {
  return /\/board\/get_tasks/i.test(url);
}

function boardIdInPayload(json: unknown, boardId: string | null): boolean {
  if (!boardId) return false;
  const tasks = extractTaskArray(json);
  if (!tasks?.length) return false;
  return tasks.some(
    (t) =>
      t &&
      typeof t === "object" &&
      String((t as Record<string, unknown>).boardId) === boardId,
  );
}

function countTasksInPayload(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const candidates: unknown[] = [];

  const pushIfArray = (v: unknown) => {
    if (Array.isArray(v) && v.length > 0) candidates.push(v);
  };

  pushIfArray(root.tasks);
  pushIfArray(root.taskList);
  pushIfArray(root.data);

  if (root.data && typeof root.data === "object") {
    const data = root.data as Record<string, unknown>;
    pushIfArray(data.tasks);
    pushIfArray(data.taskList);
    pushIfArray(data.projectList);
    pushIfArray(data.categories);
    pushIfArray(data.items);
  }

  if (Array.isArray(root.data)) {
    for (const item of root.data) {
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        pushIfArray(row.tasks);
        pushIfArray(row.taskList);
        pushIfArray(row.cards);
        pushIfArray(row.projects);
      }
    }
  }

  let best = 0;
  for (const arr of candidates) {
    if (Array.isArray(arr)) best = Math.max(best, arr.length);
  }
  return best > 0 ? best : null;
}

function extractTaskArray(json: unknown): unknown[] | null {
  const count = countTasksInPayload(json);
  if (!count) return null;

  const walk = (value: unknown): unknown[] | null => {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      if (value.length >= count && value[0] && typeof value[0] === "object") {
        const first = value[0] as Record<string, unknown>;
        if ("id" in first || "title" in first || "name" in first) return value;
      }
    }
    if (typeof value === "object") {
      for (const child of Object.values(value as Record<string, unknown>)) {
        const found = walk(child);
        if (found) return found;
      }
    }
    return null;
  };

  return walk(json);
}

function keysFromTaskObjects(tasks: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const t of tasks.slice(0, 5)) {
    for (const k of collectKeysFromObject(t)) keys.add(k);
  }
  return keys;
}

function collectKeysFromObject(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${key}` : key;
    out.push(p);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...collectKeysFromObject(value, p));
    }
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      out.push(...collectKeysFromObject(value[0], `${p}[]`));
    }
  }
  return out;
}

function mapApiKeysToRawTaskFields(apiKeys: Iterable<string>): Set<RawTaskField> {
  const fields = new Set<RawTaskField>();
  for (const keyPath of apiKeys) {
    const keyLower = keyPath.toLowerCase();
    for (const { pattern, fields: mapped } of API_KEY_TO_RAW_TASK) {
      if (pattern.test(keyLower)) {
        for (const f of mapped) fields.add(f);
      }
    }
  }
  if ([...apiKeys].some((k) => /id/.test(k.toLowerCase()))) fields.add("id");
  if ([...apiKeys].some((k) => /title|name/.test(k.toLowerCase()))) fields.add("title");
  return fields;
}

function attachNetworkCollector(
  page: Page,
  phase: CapturedResponse["phase"],
  bucket: CapturedResponse[],
): () => void {
  const onResponse = async (response: Response) => {
    const req = response.request();
    const url = response.url();
    if (!urlLooksRelevant(url)) return;

    const entry: CapturedResponse = {
      ts: new Date().toISOString(),
      phase,
      method: req.method(),
      url,
      status: response.status(),
      resourceType: req.resourceType(),
      requestPostData: req.postData() ?? undefined,
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
          entry.jsonKeys = [...new Set(collectJsonKeys(parsed))].slice(0, 200);
          entry.jsonSample = parsed;
          entry.bodyPreview = text.slice(0, 8000);
          entry.taskKeywordHits = [...findTaskKeywordHits(parsed)];
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

    bucket.push(entry);
  };

  const wrapper = (response: Response) => {
    void onResponse(response);
  };
  page.on("response", wrapper);
  return () => page.off("response", wrapper);
}

function pickBestTaskListResponse(
  entries: CapturedResponse[],
  boardId: string | null,
): CapturedResponse | null {
  let best: CapturedResponse | null = null;
  let bestScore = 0;

  for (const e of entries) {
    if (e.bodyKind !== "json" || !e.jsonSample) continue;
    if (isBoardListEndpoint(e.url)) continue;

    const count = countTasksInPayload(e.jsonSample) ?? 0;
    if (count === 0) continue;

    let score = count;
    if (isTaskListEndpoint(e.url)) score += 10_000;
    if (boardIdInPayload(e.jsonSample, boardId)) score += 50_000;
    score += (e.taskKeywordHits?.length ?? 0) * 10;

    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }

  return best;
}

async function triggerLazyBoardLoads(page: Page): Promise<void> {
  await page
    .locator(BOARD_SELECTORS.category)
    .first()
    .waitFor({ state: "attached", timeout: 90_000 });

  await expandAllCategories(page);
  await page.waitForTimeout(1500);

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2000);
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
}

function pickBestTaskDetailsResponse(
  entries: CapturedResponse[],
  listKeys: Set<string>,
): CapturedResponse | null {
  const candidates = entries.filter(
    (e) =>
      e.phase === "task_details" &&
      e.bodyKind === "json" &&
      e.jsonSample &&
      (e.taskKeywordHits?.length ?? 0) > 0,
  );

  let best: CapturedResponse | null = null;
  let bestScore = 0;

  for (const e of candidates) {
    const keys = new Set(collectJsonKeys(e.jsonSample));
    let extra = 0;
    for (const k of keys) {
      if (!listKeys.has(k)) extra++;
    }
    const score = extra + (e.taskKeywordHits?.length ?? 0);
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }

  return best ?? candidates[0] ?? null;
}

function buildSummary(args: {
  boardUrl: string;
  boardId: string | null;
  allEntries: CapturedResponse[];
  listResponse: CapturedResponse | null;
  detailsResponse: CapturedResponse | null;
  sampleTaskId: string | null;
}): Record<string, unknown> {
  const endpoints = [
    ...new Set(
      args.allEntries
        .filter((e) => e.bodyKind === "json" && (e.taskKeywordHits?.length ?? 0) > 0)
        .map((e) => `${e.method} ${e.url.split("?")[0]}`),
    ),
  ].sort();

  const listTasks = args.listResponse?.jsonSample
    ? extractTaskArray(args.listResponse.jsonSample)
    : null;
  const taskCount = listTasks?.length ?? countTasksInPayload(args.listResponse?.jsonSample) ?? 0;

  const listKeys = listTasks ? keysFromTaskObjects(listTasks) : new Set<string>();
  const detailsKeys =
    args.detailsResponse?.jsonSample
      ? new Set(collectJsonKeys(args.detailsResponse.jsonSample))
      : new Set<string>();

  const detailsOnlyKeys = [...detailsKeys].filter((k) => !listKeys.has(k));

  const listFields = mapApiKeysToRawTaskFields(listKeys);
  const detailsFields = mapApiKeysToRawTaskFields(detailsKeys);
  const combinedFields = new Set([...listFields, ...detailsFields]);

  if (listKeys.has("data[].plannedEndTime") || listKeys.has("plannedEndTime")) {
    combinedFields.add("dueDate");
  }
  if (listKeys.has("data[].plannedStartTime") || listKeys.has("plannedStartTime")) {
    combinedFields.add("startDate");
  }
  if (listKeys.has("data[].stateId") || listKeys.has("stateId")) {
    combinedFields.add("status");
  }
  if (listKeys.has("data[].userList") || listKeys.has("userList")) {
    combinedFields.add("assignees");
    combinedFields.add("assigneeRefs");
  }
  if (detailsKeys.has("data.content") || [...detailsKeys].some((k) => /content/i.test(k))) {
    combinedFields.add("descriptionText");
  }

  if (taskCount > 0) {
    combinedFields.add("id");
    combinedFields.add("url");
  }

  const missingFields = RAW_TASK_FIELDS.filter((f) => !combinedFields.has(f));
  const listOnlyFields = [...listFields].filter((f) => !detailsFields.has(f));
  const detailsOnlyFields = [...detailsFields].filter((f) => !listFields.has(f));

  const criticalForRules = [
    "title",
    "descriptionText",
    "dueDate",
    "status",
    "stage",
    "assignees",
    "tags",
    "links",
    "comments",
  ] as const;
  const criticalMissing = criticalForRules.filter((f) => !combinedFields.has(f));

  const hasGetTasks = args.allEntries.some((e) => isTaskListEndpoint(e.url));

  const canBuildPartial =
    combinedFields.has("id") &&
    combinedFields.has("title") &&
    (combinedFields.has("status") || combinedFields.has("stage"));

  const canBuildFull =
    missingFields.filter((f) => f !== "links" && f !== "stage" && f !== "actualTime")
      .length <= 2 && criticalMissing.filter((f) => f !== "links").length <= 1;

  const apiFirstFeasible =
    hasGetTasks && canBuildPartial && taskCount >= 10;

  let expectedSpeedup = "unknown";
  if (taskCount > 0) {
    const modalSecondsPerTask = 8;
    const apiSecondsPerTask = 0.15;
    const currentEstimateSec = taskCount * modalSecondsPerTask;
    const apiEstimateSec = 30 + taskCount * apiSecondsPerTask;
    const ratio = currentEstimateSec / Math.max(apiEstimateSec, 1);
    expectedSpeedup = `~${ratio.toFixed(0)}x for ${taskCount} tasks (heuristic: ${modalSecondsPerTask}s/modal vs ${apiSecondsPerTask}s/API)`;
  }

  return {
    boardUrl: args.boardUrl,
    boardId: args.boardId,
    capturedAt: new Date().toISOString(),
    sampleTaskId: args.sampleTaskId,
    endpointsFound: endpoints,
    taskCountFromListApi: taskCount,
    bestListEndpoint: args.listResponse
      ? {
          method: args.listResponse.method,
          url: args.listResponse.url,
          status: args.listResponse.status,
          requestPostData: args.listResponse.requestPostData,
          taskKeywordHits: args.listResponse.taskKeywordHits,
        }
      : null,
    bestDetailsEndpoint: args.detailsResponse
      ? {
          method: args.detailsResponse.method,
          url: args.detailsResponse.url,
          status: args.detailsResponse.status,
          requestPostData: args.detailsResponse.requestPostData,
          taskKeywordHits: args.detailsResponse.taskKeywordHits,
        }
      : null,
    fieldsInListResponse: [...listKeys].sort().slice(0, 120),
    fieldsOnlyInDetails: detailsOnlyKeys.slice(0, 80),
    rawTaskFieldsFromList: [...listFields].sort(),
    rawTaskFieldsFromDetails: [...detailsFields].sort(),
    rawTaskFieldsFromDetailsOnly: detailsOnlyFields.sort(),
    rawTaskFieldsCombined: [...combinedFields].sort(),
    missingRawTaskFields: missingFields,
    criticalRuleFieldsMissing: criticalMissing,
    canBuildRawTaskWithoutOpeningCard: canBuildFull,
    canBuildPartialRawTaskFromApi: canBuildPartial,
    apiFirstCollectorFeasible: apiFirstFeasible,
    conclusion: apiFirstFeasible
      ? canBuildFull
        ? "API-first collector feasible: get_tasks + get_states + get_task_details/comments; Playwright only for session."
        : "Hybrid API-first: get_tasks for list fields; get_task_details for description/attachments; minimal DOM."
      : hasGetTasks
        ? "get_tasks captured but field mapping incomplete — inspect tasks-api-response.json"
        : "get_tasks not captured on board load (lazy); retry probe after scroll or call API explicitly.",
    expectedSpeedupEstimate: expectedSpeedup,
    boardMetaEndpoints: {
      get_details: args.allEntries.some((e) => /get_details/i.test(e.url)),
      get_states: args.allEntries.some((e) => /get_states/i.test(e.url)),
      get_blocks: args.allEntries.some((e) => /get_blocks/i.test(e.url)),
      get_tasks: hasGetTasks,
    },
    notes: [
      "POST /board/get — список досок компании, не задачи на доске",
      "POST /board/get_tasks — список карточек (основной кандидат для API-first)",
      "POST /board/get_task_details — полное описание, content, attachments",
      "POST /board/get_states — колонки (status) по stateId",
      "POST /board/get_task_comments — комментарии (уже реализовано)",
      "POST /panel/profile/get_users — пользователи (уже используется)",
      "url на RawTask: boardUrl + /{taskId}",
      "links в карточке могут быть только в content HTML — нужна вытяжка URL из HTML",
      listTasks && listTasks.length > 0
        ? `list sample keys: ${[...listKeys].slice(0, 25).join(", ")}`
        : "get_tasks не перехвачен — прокрутите доску или повторите probe",
    ],
  };
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const boardId = parseBoardId(opts.boardUrl);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  assertProfileExists();

  console.log("=== Board API probe ===\n");
  console.log(`Board: ${opts.boardUrl}`);

  const allEntries: CapturedResponse[] = [];
  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const stopBoard = attachNetworkCollector(page, "board", allEntries);
    await openBoardWithReadiness(page, opts.boardUrl);
    await triggerLazyBoardLoads(page);
    stopBoard();

    let stopDetails = () => undefined;
    if (!opts.skipDetails && opts.sampleTaskId) {
      const taskUrl = `${opts.boardUrl.replace(/\/$/, "")}/${opts.sampleTaskId}`;
      console.log(`\nSample task URL (details phase): ${taskUrl}`);
      stopDetails = attachNetworkCollector(page, "task_details", allEntries);
      await page.goto(taskUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page
        .locator(TASK_MODAL_SELECTORS.root)
        .waitFor({ state: "visible", timeout: 45_000 })
        .catch(() => undefined);
      await page.waitForTimeout(4000);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      stopDetails();
    }

    const listResponse = pickBestTaskListResponse(
      allEntries.filter((e) => e.phase === "board"),
      boardId,
    );
    const listKeys = listResponse?.jsonSample
      ? new Set(collectJsonKeys(listResponse.jsonSample))
      : new Set<string>();
    const detailsResponse = pickBestTaskDetailsResponse(
      allEntries,
      listKeys,
    );

    const networkOut = {
      boardUrl: opts.boardUrl,
      capturedAt: new Date().toISOString(),
      totalCaptured: allEntries.length,
      jsonResponses: allEntries.filter((e) => e.bodyKind === "json").length,
      entries: allEntries.map((e) => ({
        ...e,
        jsonSample: undefined,
        bodyPreview: e.bodyPreview ? `${e.bodyPreview.slice(0, 500)}…` : undefined,
      })),
      fullJsonSamples: allEntries
        .filter((e) => e.bodyKind === "json")
        .map((e) => ({
          phase: e.phase,
          method: e.method,
          url: e.url,
          status: e.status,
          taskKeywordHits: e.taskKeywordHits,
          jsonKeys: e.jsonKeys,
          requestPostData: e.requestPostData,
          jsonSample: e.jsonSample,
        })),
    };

    fs.writeFileSync(OUT_NETWORK, JSON.stringify(networkOut, null, 2), "utf8");

    if (listResponse?.jsonSample) {
      fs.writeFileSync(
        OUT_TASKS,
        JSON.stringify(
          {
            source: {
              method: listResponse.method,
              url: listResponse.url,
              status: listResponse.status,
              requestPostData: listResponse.requestPostData,
              taskKeywordHits: listResponse.taskKeywordHits,
            },
            taskCount: countTasksInPayload(listResponse.jsonSample),
            response: listResponse.jsonSample,
          },
          null,
          2,
        ),
        "utf8",
      );
    } else {
      fs.writeFileSync(
        OUT_TASKS,
        JSON.stringify(
          { message: "No board-load response with a task array was identified" },
          null,
          2,
        ),
        "utf8",
      );
    }

    if (detailsResponse?.jsonSample) {
      fs.writeFileSync(
        OUT_DETAILS,
        JSON.stringify(
          {
            source: {
              method: detailsResponse.method,
              url: detailsResponse.url,
              status: detailsResponse.status,
              requestPostData: detailsResponse.requestPostData,
              taskKeywordHits: detailsResponse.taskKeywordHits,
            },
            response: detailsResponse.jsonSample,
          },
          null,
          2,
        ),
        "utf8",
      );
    } else {
      fs.writeFileSync(
        OUT_DETAILS,
        JSON.stringify(
          {
            message: opts.skipDetails
              ? "Details phase skipped (--skip-details)"
              : "No task-details API response identified",
          },
          null,
          2,
        ),
        "utf8",
      );
    }

    const summary = buildSummary({
      boardUrl: opts.boardUrl,
      boardId,
      allEntries,
      listResponse,
      detailsResponse,
      sampleTaskId: opts.sampleTaskId,
    });

    fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n--- Summary ---");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nSaved:\n  ${OUT_NETWORK}\n  ${OUT_TASKS}\n  ${OUT_DETAILS}\n  ${OUT_SUMMARY}`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
