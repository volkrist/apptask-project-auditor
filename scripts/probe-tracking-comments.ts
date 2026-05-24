/**
 * Diagnostic: tracking / screenshots / activities comments (not board task comments).
 * Does not change rules, parser, reports, Discord, or profile path.
 *
 * Run:
 *   npm run probe:tracking:comments
 *   npx tsx scripts/probe-tracking-comments.ts --url "https://apptask.ru/c/7/activities/..."
 *
 * Env: APPTASK_ACTIVITIES_URL
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOM_PARSE_PATH = path.join(SCRIPT_DIR, "probe-tracking-comments-dom.parse.js");

const DEFAULT_ACTIVITIES_URL =
  "https://apptask.ru/c/7/activities/2026-05-20/684/0";

const OUT_DIR = path.join("output", "debug", "tracking-comments");
const OUT_PNG = path.join(OUT_DIR, "page.png");
const OUT_HTML = path.join(OUT_DIR, "page.html");
const OUT_TEXT = path.join(OUT_DIR, "page-text.txt");
const OUT_NETWORK = path.join(OUT_DIR, "network.json");
const OUT_API = path.join(OUT_DIR, "comments-api-response.json");
const OUT_SCREENS_API = path.join(OUT_DIR, "tracking-screens-api-response.json");
const OUT_DOM = path.join(OUT_DIR, "dom-comments.json");
const OUT_SUMMARY = path.join(OUT_DIR, "summary.json");

const KEYWORD_RE =
  /comment|comments|комментар|activity|screenshot|screen|snapshot|tracking|proof|description|note|drive\.google|timefrom|timeto|userid|taskid|screenshotid/i;

const TEXT_HINT_RE =
  /комментар|comment|drive\.google|screenshot|snapshot|activity|tracking|proof/i;

type CapturedNet = {
  ts: string;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  bodyKind: "json" | "text" | "empty" | "error";
  jsonBody?: unknown;
  textPreview?: string;
  keywordHits?: string[];
  relevanceScore?: number;
};

type FieldPresence = {
  commentId: boolean;
  id: boolean;
  taskId: boolean;
  taskName: boolean;
  taskUrl: boolean;
  userId: boolean;
  userName: boolean;
  screenshotId: boolean;
  activityId: boolean;
  createdAt: boolean;
  timeFrom: boolean;
  timeTo: boolean;
  text: boolean;
  comment: boolean;
  url: boolean;
  link: boolean;
};

export type TrackingDomComment = {
  userName: string | null;
  projectName: string | null;
  taskName: string | null;
  timeRange: string | null;
  activityPercent: string | null;
  commentText: string | null;
  links: string[];
};

function parseCliUrl(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url" && argv[i + 1]) return argv[i + 1].trim();
    if (argv[i]?.startsWith("--url=")) return argv[i].slice("--url=".length).trim();
  }
  return null;
}

function resolveTargetUrl(): string {
  return (
    parseCliUrl(process.argv.slice(2)) ??
    process.env.APPTASK_ACTIVITIES_URL?.trim() ??
    DEFAULT_ACTIVITIES_URL
  );
}

function ensureDirs(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function attachNetworkCollector(page: Page): {
  getEntries: () => CapturedNet[];
  stop: () => void;
} {
  const entries: CapturedNet[] = [];

  const onResponse = (response: Response) => {
    void (async () => {
      const url = response.url();
      if (!/apptask\.ru/i.test(url)) return;
      const rt = response.request().resourceType();
      if (rt !== "xhr" && rt !== "fetch") return;

      const base: CapturedNet = {
        ts: new Date().toISOString(),
        method: response.request().method(),
        url,
        status: response.status(),
        resourceType: rt,
        bodyKind: "empty",
      };

      try {
        const text = await response.text();
        if (!text) {
          entries.push(base);
          return;
        }
        try {
          const jsonBody = JSON.parse(text) as unknown;
          const serialized = JSON.stringify(jsonBody);
          const keywordHits = [
            ...new Set(
              (serialized.match(KEYWORD_RE) ?? []).map((k) => k.toLowerCase()),
            ),
          ];
          let relevanceScore = keywordHits.length;
          if (/comment|комментар/i.test(serialized)) relevanceScore += 15;
          if (/screenshot|screen|snapshot|activity|tracking/i.test(url))
            relevanceScore += 10;
          if (/drive\.google/i.test(serialized)) relevanceScore += 8;
          if (/TimeTracker|tracking|screenshot|activity/i.test(url))
            relevanceScore += 12;

          entries.push({
            ...base,
            bodyKind: "json",
            jsonBody,
            keywordHits,
            relevanceScore,
          });
        } catch {
          const preview = text.slice(0, 2000);
          const keywordHits = [
            ...new Set(
              (preview.match(KEYWORD_RE) ?? []).map((k) => k.toLowerCase()),
            ),
          ];
          entries.push({
            ...base,
            bodyKind: "text",
            textPreview: preview,
            keywordHits,
            relevanceScore: TEXT_HINT_RE.test(preview) ? keywordHits.length + 5 : 0,
          });
        }
      } catch {
        entries.push({ ...base, bodyKind: "error" });
      }
    })();
  };

  page.on("response", onResponse);
  return {
    getEntries: () => [...entries],
    stop: () => page.off("response", onResponse),
  };
}

function collectObjectKeys(obj: unknown, depth = 0, prefix = ""): string[] {
  if (depth > 5 || obj === null || obj === undefined) return [];
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    return collectObjectKeys(obj[0], depth + 1, `${prefix}[]`);
  }
  if (typeof obj !== "object") return [];
  const keys: string[] = [];
  for (const [key, child] of Object.entries(obj as Record<string, unknown>)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    keys.push(pathKey);
    keys.push(...collectObjectKeys(child, depth + 1, pathKey));
  }
  return keys;
}

function scanFieldPresence(json: unknown): FieldPresence {
  const keys = collectObjectKeys(json);
  const keyStr = keys.join("|").toLowerCase();
  const blob = JSON.stringify(json).toLowerCase();

  const has = (patterns: RegExp[]) =>
    patterns.some((p) => p.test(keyStr) || p.test(blob));

  return {
    commentId: has([/commentid/, /\.comment\.id/]),
    id: has([/^id$/, /\.id$/]),
    taskId: has([/taskid/, /task\.id/]),
    taskName: has([/taskname/, /task\.name/, /tasktitle/]),
    taskUrl: has([/taskurl/, /task\.url/, /href.*board/]) || /\/board\/\d+/.test(blob),
    userId: has([/userid/, /user\.id/]),
    userName: has([/username/, /user\.name/, /realname/, /displayname/]),
    screenshotId: has([/screenshotid/, /screenid/, /snapshotid/]),
    activityId: has([/activityid/]),
    createdAt: has([/createdat/, /createtime/, /datetime/]),
    timeFrom: has([/timefrom/, /starttime/, /fromtime/]),
    timeTo: has([/timeto/, /endtime/, /totime/]),
    text: has([/^text$/, /\.text$/, /description/]),
    comment: has([/^comment$/, /commenttext/, /commentlist/, /comments/]),
    url: has([/^url$/, /\.url$/, /drive\.google/, /link/]),
    link: has([/link/, /href/]),
  };
}

function findCommentSamples(
  json: unknown,
  path = "",
  samples: unknown[] = [],
): unknown[] {
  if (samples.length >= 5 || json === null || json === undefined) return samples;

  if (Array.isArray(json)) {
    for (let i = 0; i < Math.min(json.length, 5); i++) {
      findCommentSamples(json[i], `${path}[${i}]`, samples);
    }
    return samples;
  }

  if (typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/comment/i.test(key) && val !== null && val !== undefined) {
        samples.push({ path: childPath, value: val });
      }
      findCommentSamples(val, childPath, samples);
    }
  }
  return samples;
}

function pickBestApiEntry(entries: CapturedNet[]): CapturedNet | null {
  const candidates = entries
    .filter((e) => e.bodyKind === "json" && (e.relevanceScore ?? 0) > 0)
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
  return candidates[0] ?? null;
}

async function extractDomComments(page: Page): Promise<{
  cards: TrackingDomComment[];
  commentMarkerCount: number;
}> {
  await page.addScriptTag({ path: DOM_PARSE_PATH }).catch(() => {});
  const result = await page.evaluate(() => {
    // @ts-expect-error injected
    return typeof extractTrackingDomComments === "function"
      ? extractTrackingDomComments()
      : null;
  });

  if (!result) return { cards: [], commentMarkerCount: 0 };
  return {
    cards: (result.cards ?? []) as TrackingDomComment[],
    commentMarkerCount: result.commentMarkerCount ?? 0,
  };
}

async function main(): Promise<void> {
  ensureDirs();
  assertProfileExists();

  const targetUrl = resolveTargetUrl();
  console.log("=== Tracking comments diagnostic ===\n");
  console.log(`URL: ${targetUrl}`);

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const net = attachNetworkCollector(page);

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1500);

    await page.screenshot({ path: OUT_PNG, fullPage: true }).catch(() => undefined);

    const pageText = await page.locator("body").innerText().catch(() => "");
    fs.writeFileSync(OUT_TEXT, pageText, "utf8");

    const pageHtml =
      (await page.locator("main").first().innerHTML().catch(() => null)) ??
      (await page.locator("body").innerHTML().catch(() => ""));
    fs.writeFileSync(OUT_HTML, pageHtml, "utf8");

    const domResult = await extractDomComments(page);
    fs.writeFileSync(OUT_DOM, JSON.stringify(domResult.cards, null, 2), "utf8");
    console.log(`DOM cards with comment: ${domResult.cards.length}`);

    const entries = net.getEntries();
    fs.writeFileSync(
      OUT_NETWORK,
      JSON.stringify(
        {
          pageUrl: page.url(),
          targetUrl,
          capturedAt: new Date().toISOString(),
          entryCount: entries.length,
          captured: entries.map((e) => ({
            ...e,
            jsonBody:
              e.bodyKind === "json" && e.relevanceScore && e.relevanceScore < 3
                ? "[omitted — low relevance]"
                : e.jsonBody,
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`Network saved: ${OUT_NETWORK} (${entries.length} entries)`);

    const bestApi = pickBestApiEntry(entries);
    const screensApi = entries.find((e) =>
      /get_user_tracking_screens/i.test(e.url),
    );
    const allKeys = bestApi?.jsonBody
      ? [...new Set(collectObjectKeys(bestApi.jsonBody))].sort()
      : [];

    const fields = bestApi?.jsonBody
      ? scanFieldPresence(bestApi.jsonBody)
      : null;

    const commentSamples = bestApi?.jsonBody
      ? findCommentSamples(bestApi.jsonBody)
      : [];

    const hasCommentTextInApi =
      Boolean(
        bestApi &&
          (/comment|комментар/i.test(JSON.stringify(bestApi.jsonBody)) ||
            commentSamples.length > 0),
      );

    if (screensApi?.jsonBody) {
      fs.writeFileSync(
        OUT_SCREENS_API,
        JSON.stringify(
          {
            sourceUrl: screensApi.url,
            method: screensApi.method,
            status: screensApi.status,
            allKeys: [...new Set(collectObjectKeys(screensApi.jsonBody))].sort().slice(0, 120),
            fields: scanFieldPresence(screensApi.jsonBody),
            areaListSample: (() => {
              const body = screensApi.jsonBody as Record<string, unknown>;
              const areas = body.areaList;
              return Array.isArray(areas) ? areas.slice(0, 2) : null;
            })(),
            body: screensApi.jsonBody,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`Tracking screens API saved: ${OUT_SCREENS_API}`);
    }

    if (bestApi?.jsonBody && hasCommentTextInApi) {
      fs.writeFileSync(
        OUT_API,
        JSON.stringify(
          {
            sourceUrl: bestApi.url,
            method: bestApi.method,
            status: bestApi.status,
            relevanceScore: bestApi.relevanceScore,
            keywordHits: bestApi.keywordHits,
            allKeys: allKeys.slice(0, 200),
            commentSamples,
            body: bestApi.jsonBody,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`Comments API saved: ${OUT_API}`);
    } else if (bestApi) {
      fs.writeFileSync(
        OUT_API,
        JSON.stringify(
          {
            note: "Best-scoring JSON captured but no clear comment payload",
            sourceUrl: bestApi.url,
            relevanceScore: bestApi.relevanceScore,
            keywordHits: bestApi.keywordHits,
            allKeys: allKeys.slice(0, 120),
            body: bestApi.jsonBody,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.log(`API candidate saved (weak): ${OUT_API}`);
    }

    const pageHasCommentLabel = /комментарий\s*:/i.test(pageText);
    const domHasComments = domResult.cards.some(
      (c) => (c.commentText && c.commentText.length > 0) || c.links.length > 0,
    );

    const summary = {
      generatedAt: new Date().toISOString(),
      targetUrl,
      finalPageUrl: page.url(),
      artifacts: {
        png: OUT_PNG,
        html: OUT_HTML,
        text: OUT_TEXT,
        network: OUT_NETWORK,
        domComments: OUT_DOM,
        commentsApi: fs.existsSync(OUT_API) ? OUT_API : null,
      },
      trackingCommentsApiFound: Boolean(bestApi && hasCommentTextInApi),
      trackingScreensApi: screensApi
        ? {
            endpoint: screensApi.url,
            hasAreaList: Boolean(
              (screensApi.jsonBody as Record<string, unknown>)?.areaList,
            ),
            areaCount: Array.isArray(
              (screensApi.jsonBody as Record<string, unknown>)?.areaList,
            )
              ? ((screensApi.jsonBody as Record<string, unknown>).areaList as unknown[])
                  .length
              : 0,
            hasCommentFieldInJson: /comment|комментар/i.test(
              JSON.stringify(screensApi.jsonBody),
            ),
            fields: scanFieldPresence(screensApi.jsonBody),
            artifact: OUT_SCREENS_API,
          }
        : null,
      bestEndpoint: bestApi?.url ?? null,
      bestMethod: bestApi?.method ?? null,
      bestApiRelevanceScore: bestApi?.relevanceScore ?? null,
      fieldsPresent: fields,
      allApiKeysSample: allKeys.slice(0, 80),
      commentFieldSamples: commentSamples,
      linkability: {
        canLinkToTask:
          fields?.taskId ||
          fields?.taskName ||
          fields?.taskUrl ||
          domResult.cards.some((c) => c.taskName),
        canLinkToUser:
          fields?.userId ||
          fields?.userName ||
          domResult.cards.some((c) => c.userName),
        canLinkToScreenshotOrActivity:
          fields?.screenshotId ||
          fields?.activityId ||
          /screenshot|activity|tracking/i.test(bestApi?.url ?? ""),
        notes: [
          fields?.taskId
            ? "API has taskId — can join to board task"
            : fields?.taskName
              ? "API has task name only — fuzzy match"
              : "task link from API not confirmed",
          fields?.userId
            ? "API has userId"
            : fields?.userName
              ? "API has user name"
              : "user link from API not confirmed",
          fields?.screenshotId || fields?.activityId
            ? "API has screenshot/activity id"
            : "screenshot/activity id not found in JSON keys",
        ],
      },
      dom: {
        pageHasCommentLabel,
        commentMarkerCount: domResult.commentMarkerCount,
        cardsWithComment: domResult.cards.length,
        cardsWithLinks: domResult.cards.filter((c) => c.links.length > 0).length,
        sample: domResult.cards.slice(0, 3),
      },
      relevantEndpoints: entries
        .filter((e) => (e.relevanceScore ?? 0) >= 5)
        .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
        .slice(0, 15)
        .map((e) => ({
          method: e.method,
          url: e.url,
          score: e.relevanceScore,
          keywordHits: e.keywordHits,
        })),
      conclusion: {
        dataSource:
          hasCommentTextInApi && domHasComments
            ? "API + DOM"
            : hasCommentTextInApi
              ? "API (primary)"
              : domHasComments
                ? "DOM only"
                : pageHasCommentLabel
                  ? "DOM label only — parse cards manually"
                  : "not found on this URL",
        canBuildRuleWithoutHeuristics: Boolean(
          hasCommentTextInApi &&
            (fields?.comment || fields?.text) &&
            (fields?.taskId || fields?.userId || fields?.activityId),
        ),
        recommendation: hasCommentTextInApi
          ? "Repeat probe on URL with non-empty comments; inspect comments-api-response.json field paths"
          : domHasComments
            ? "Comments visible in DOM only — need API with same payload or server-side export"
            : "Try --url with a date/user that has screenshot activity comments; board get_task_comments is a different channel",
      },
      noCommentsOnPage:
        !pageHasCommentLabel &&
        domResult.cards.length === 0 &&
        !hasCommentTextInApi,
    };

    fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n=== Summary ===");
    console.log(
      `Tracking comments API: ${summary.trackingCommentsApiFound ? "yes" : "no"}`,
    );
    if (summary.bestEndpoint) console.log(`Endpoint: ${summary.bestEndpoint}`);
    console.log(`DOM comment cards: ${domResult.cards.length}`);
    console.log(`Data source: ${summary.conclusion.dataSource}`);
    console.log(`Full summary: ${OUT_SUMMARY}`);

    if (summary.noCommentsOnPage) {
      console.log(
        "\nNote: no comments on this URL — not an error; retry with --url or APPTASK_ACTIVITIES_URL",
      );
    }
  } finally {
    net.stop();
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
