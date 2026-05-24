/**
 * Users / inactive diagnostic: network API, scroll table, menu sections, compare lists.
 * Does not change rules, parser, RawTask, Discord, reports, or profile path.
 *
 * Run:
 *   npx tsx scripts/probe-users-inactive-diagnostic.ts
 * Requires APPTASK_USERS_URL in .env (default: https://apptask.ru/c/7/settings/users)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";

const DEBUG_DIR = path.join("output", "debug");
const SECTIONS_DIR = path.join(DEBUG_DIR, "sections");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PARSE_SCRIPT_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "src",
  "scripts",
  "debug-users-page.parse.js",
);

const USERS_URL =
  process.env.APPTASK_USERS_URL?.trim() ??
  "https://apptask.ru/c/7/settings/users";
const BOARD_URL =
  process.env.APPTASK_BOARD_URL?.trim() ??
  "https://apptask.ru/c/7/board/445";

function isUserFieldKey(key: string): boolean {
  const k = key.toLowerCase();
  return /^(name|fullname|firstname|lastname|username|displayname|role|active|isactive|status|disabled|fired|blocked|deleted|invite|accepted|email|phone|contacts|discord|telegram|userid|id)$/.test(
    k,
  );
}

function isStatusFieldKey(key: string): boolean {
  const k = key.toLowerCase();
  return /^(active|isactive|status|disabled|fired|blocked|deleted)$/.test(k);
}

const EXPLICIT_INACTIVE_VALUES =
  /^(inactive|disabled|blocked|fired|deleted|deactivated|уволен|заблокирован|неактивен|false|0)$/i;

const EXPLICIT_ACTIVE_VALUES =
  /^(active|enabled|активен|true|1)$/i;

type CapturedNet = {
  ts: string;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  bodyKind: "json" | "text" | "empty" | "error";
  jsonBody?: unknown;
  textPreview?: string;
};

type UserRowSample = {
  fullName: string;
  role: string;
  projectsCount: string;
  timeTrackingStatus: string;
  profileUrl: string | null;
  visibleStatusText: string | null;
  isActive: boolean | null;
};

type ApiUserRecord = Record<string, unknown>;

function ensureDirs(): void {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  fs.mkdirSync(SECTIONS_DIR, { recursive: true });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function attachNetworkCollector(page: Page): {
  getEntries: () => CapturedNet[];
  reset: () => void;
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
          entries.push({ ...base, bodyKind: "json", jsonBody: JSON.parse(text) });
        } catch {
          entries.push({
            ...base,
            bodyKind: "text",
            textPreview: text.slice(0, 2000),
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
    reset: () => {
      entries.length = 0;
    },
    stop: () => page.off("response", onResponse),
  };
}

function collectObjectKeys(obj: unknown, depth = 0): string[] {
  if (depth > 4 || !obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    return collectObjectKeys(obj[0], depth + 1);
  }
  return Object.keys(obj as Record<string, unknown>);
}

function findUserArrays(
  value: unknown,
  path = "",
  hits: Array<{ path: string; items: ApiUserRecord[] }> = [],
): Array<{ path: string; items: ApiUserRecord[] }> {
  if (hits.length > 20 || value === null || value === undefined) return hits;

  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
      const keys = Object.keys(value[0] as Record<string, unknown>);
      const score = keys.filter((k) => isUserFieldKey(k)).length;
      if (score >= 2 || keys.some((k) => /user|member|employee|staff/i.test(k))) {
        hits.push({
          path: path || "root",
          items: value as ApiUserRecord[],
        });
      }
    }
    for (let i = 0; i < Math.min(value.length, 3); i++) {
      findUserArrays(value[i], `${path}[${i}]`, hits);
    }
    return hits;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (/user|member|employee|staff|people|linq/i.test(key)) {
        findUserArrays(child, childPath, hits);
      }
      findUserArrays(child, childPath, hits);
    }
  }
  return hits;
}

function pickBestUserList(
  entries: CapturedNet[],
): { items: ApiUserRecord[]; sourceUrl: string; path: string } | null {
  let best: { items: ApiUserRecord[]; sourceUrl: string; path: string; score: number } | null =
    null;

  for (const entry of entries) {
    if (entry.bodyKind !== "json" || !entry.jsonBody) continue;
    const hits = findUserArrays(entry.jsonBody);
    for (const hit of hits) {
      const keys = new Set<string>();
      for (const item of hit.items.slice(0, 5)) {
        Object.keys(item).forEach((k) => keys.add(k));
      }
      const keyList = [...keys];
      let score = hit.items.length;
      score += keyList.filter((k) => isUserFieldKey(k)).length * 3;
      if (keyList.some((k) => isStatusFieldKey(k))) score += 10;
      if (/get_user|users|members|staff|employee|linq/i.test(entry.url)) score += 15;

      if (!best || score > best.score) {
        best = {
          items: hit.items,
          sourceUrl: entry.url,
          path: hit.path,
          score,
        };
      }
    }
  }

  return best
    ? { items: best.items, sourceUrl: best.sourceUrl, path: best.path }
    : null;
}

function analyzeUserRecords(items: ApiUserRecord[]): {
  count: number;
  allFields: string[];
  hasExplicitStatus: boolean;
  statusFields: string[];
  hasUserId: boolean;
  hasContacts: boolean;
  canDistinguishActiveInactive: boolean;
  activeExample: ApiUserRecord | null;
  inactiveExample: ApiUserRecord | null;
} {
  const allFieldsSet = new Set<string>();
  for (const item of items) {
    Object.keys(item).forEach((k) => allFieldsSet.add(k));
    for (const v of Object.values(item)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.keys(v as Record<string, unknown>).forEach((k) =>
          allFieldsSet.add(`${k}`),
        );
      }
    }
  }

  const allFields = [...allFieldsSet].sort();
  const statusFields = allFields.filter((k) => isStatusFieldKey(k));
  const hasExplicitStatus = statusFields.length > 0;

  const hasUserId = allFields.some((k) => /^userid$|^id$/i.test(k));
  const hasContacts = allFields.some((k) =>
    /email|phone|telegram|discord|contacts/i.test(k),
  );

  let activeExample: ApiUserRecord | null = null;
  let inactiveExample: ApiUserRecord | null = null;

  for (const item of items) {
    if (typeof item.blocked === "boolean") {
      if (item.blocked === false && !activeExample) activeExample = item;
      if (item.blocked === true && !inactiveExample) inactiveExample = item;
    }
    for (const field of statusFields) {
      if (field === "blocked") continue;
      const raw = item[field];
      const val =
        typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
          ? String(raw).trim()
          : "";
      if (!val) continue;
      if (EXPLICIT_INACTIVE_VALUES.test(val) && !inactiveExample) {
        inactiveExample = item;
      }
      if (EXPLICIT_ACTIVE_VALUES.test(val) && !activeExample) {
        activeExample = item;
      }
    }
    if (typeof item.active === "boolean") {
      if (item.active && !activeExample) activeExample = item;
      if (item.active === false && !inactiveExample) inactiveExample = item;
    }
    if (typeof item.isActive === "boolean") {
      if (item.isActive && !activeExample) activeExample = item;
      if (item.isActive === false && !inactiveExample) inactiveExample = item;
    }
  }

  const canDistinguishActiveInactive =
    hasExplicitStatus &&
    Boolean(activeExample || inactiveExample) &&
    (activeExample !== inactiveExample || (activeExample && inactiveExample));

  return {
    count: items.length,
    allFields,
    hasExplicitStatus,
    statusFields,
    hasUserId,
    hasContacts,
    canDistinguishActiveInactive,
    activeExample,
    inactiveExample,
  };
}

function parseActiveSummaryFromPageText(text: string): {
  activeCount: number | null;
  totalCount: number | null;
} {
  const m = text.match(/(\d+)\s*из\s*(\d+)\s*сотрудников\s*активны/i);
  if (!m) return { activeCount: null, totalCount: null };
  return { activeCount: Number(m[1]), totalCount: Number(m[2]) };
}

function displayNameFromApiUser(u: ApiUserRecord): string {
  const parts = [
    u.fullName,
    u.name,
    u.userName,
    u.displayName,
    [u.firstName, u.lastName].filter(Boolean).join(" "),
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  return parts[0] ?? "";
}

function isExplicitlyActiveUser(u: ApiUserRecord): boolean | null {
  if (typeof u.blocked === "boolean") return !u.blocked;
  for (const [key, raw] of Object.entries(u)) {
    if (!isStatusFieldKey(key) || key === "blocked") continue;
    const val = String(raw ?? "").trim();
    if (EXPLICIT_INACTIVE_VALUES.test(val)) return false;
    if (EXPLICIT_ACTIVE_VALUES.test(val)) return true;
  }
  if (typeof u.active === "boolean") return u.active;
  if (typeof u.isActive === "boolean") return u.isActive;
  return null;
}

async function scrollUsersTable(page: Page): Promise<void> {
  const selectors = [
    ".flex-table__body",
    ".users-page-content",
    ".flex-table--users",
    "main",
  ];
  for (let round = 0; round < 25; round++) {
    await page.evaluate((sels) => {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight + 10) {
          el.scrollTop = el.scrollHeight;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    }, selectors);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1000);
}

async function parseUsersFromDom(page: Page): Promise<UserRowSample[]> {
  await page.addScriptTag({ path: PARSE_SCRIPT_PATH });
  return page.evaluate("window.parseUsersInPage()") as Promise<UserRowSample[]>;
}

function extractAssigneesFromBoardJson(entries: CapturedNet[]): {
  userIds: string[];
  names: string[];
} {
  const userIds = new Set<string>();
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.bodyKind !== "json" || !entry.jsonBody) continue;
    if (!/get_tasks|get_task_details|board\//i.test(entry.url)) continue;
    const walk = (val: unknown) => {
      if (!val || typeof val !== "object") return;
      if (Array.isArray(val)) {
        val.forEach(walk);
        return;
      }
      const obj = val as Record<string, unknown>;
      if (Array.isArray(obj.userList)) {
        for (const u of obj.userList) {
          if (u && typeof u === "object") {
            const row = u as Record<string, unknown>;
            const uid = row.userId ?? row.id;
            if (uid !== undefined && uid !== null) userIds.add(String(uid));
            const name = row.userName ?? row.name ?? row.fullName;
            if (typeof name === "string" && name.trim()) names.add(name.trim());
          }
        }
      }
      for (const child of Object.values(obj)) walk(child);
    };
    walk(entry.jsonBody);
  }
  return {
    userIds: [...userIds].sort(),
    names: [...names].sort(),
  };
}

function normalizeNameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

type SectionDef = {
  section: string;
  url: string;
  navigate?: "goto" | "click-menu";
  menuSelector?: string;
};

const SECTIONS: SectionDef[] = [
  { section: "Трекинг", url: "https://apptask.ru/c/7/activities", navigate: "goto" },
  {
    section: "Мои проекты",
    url: BOARD_URL,
    navigate: "goto",
  },
  {
    section: "Пользователи",
    url: USERS_URL,
    navigate: "goto",
  },
  {
    section: "Проекты",
    url: "https://apptask.ru/c/7/settings/projects",
    navigate: "goto",
  },
  {
    section: "Общие",
    url: "https://apptask.ru/c/7/settings/users",
    navigate: "click-menu",
    menuSelector: 'span.main-menu__item-text:has-text("Общие")',
  },
  {
    section: "Уведомления",
    url: "https://apptask.ru/c/7/notifications/settings",
    navigate: "goto",
  },
  {
    section: "Иерархия",
    url: "https://apptask.ru/c/7/design/structure",
    navigate: "goto",
  },
  {
    section: "Скачать клиент",
    url: "https://apptask.ru/download",
    navigate: "goto",
  },
  {
    section: "Поддержка",
    url: "https://apptask.ru/c/7/support",
    navigate: "goto",
  },
];

async function probeSection(
  page: Page,
  def: SectionDef,
  net: ReturnType<typeof attachNetworkCollector>,
): Promise<{
  section: string;
  url: string;
  hasUsersApi: boolean;
  hasActiveStatus: boolean;
  usefulFields: string[];
  notes: string;
  usefulResponsePath: string | null;
}> {
  const slug = slugify(def.section);
  net.reset();

  try {
    if (def.navigate === "click-menu") {
      await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(1500);
      if (def.menuSelector) {
        await page.locator(def.menuSelector).first().click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
    } else {
      await page.goto(def.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      section: def.section,
      url: page.url(),
      hasUsersApi: false,
      hasActiveStatus: false,
      usefulFields: [],
      notes: `navigation failed: ${msg}`,
      usefulResponsePath: null,
    };
  }

  const finalUrl = page.url();
  const entries = net.getEntries();
  const htmlPath = path.join(SECTIONS_DIR, `${slug}.html`);
  const pngPath = path.join(SECTIONS_DIR, `${slug}.png`);
  const networkPath = path.join(SECTIONS_DIR, `${slug}-network.json`);

  const content =
    (await page.locator("main").first().innerHTML().catch(() => null)) ??
    (await page.locator("body").innerHTML());
  fs.writeFileSync(htmlPath, content, "utf8");
  await page.screenshot({ path: pngPath, fullPage: true }).catch(() => undefined);
  fs.writeFileSync(networkPath, JSON.stringify({ url: finalUrl, captured: entries }, null, 2), "utf8");

  const best = pickBestUserList(entries);
  let usefulResponsePath: string | null = null;
  let usefulFields: string[] = [];
  let hasUsersApi = false;
  let hasActiveStatus = false;
  let notes = "";

  if (best && best.items.length > 0) {
    hasUsersApi = true;
    const analysis = analyzeUserRecords(best.items);
    usefulFields = analysis.allFields;
    hasActiveStatus = analysis.hasExplicitStatus;
    usefulResponsePath = path
      .join("output", "debug", "sections", `${slug}-useful-response.json`)
      .replace(/\\/g, "/");
    fs.writeFileSync(
      path.join(SECTIONS_DIR, `${slug}-useful-response.json`),
      JSON.stringify(
        {
          sourceUrl: best.sourceUrl,
          path: best.path,
          count: best.items.length,
          analysis,
          sample: best.items.slice(0, 5),
          full: best.items,
        },
        null,
        2,
      ),
      "utf8",
    );
    notes = `API list at ${best.path} (${best.items.length} items) from ${best.sourceUrl}`;
  } else {
    const userUrls = entries
      .filter((e) => /user|member|staff|employee|linq/i.test(e.url))
      .map((e) => e.url);
    notes =
      userUrls.length > 0
        ? `No parsed user list; user-related URLs: ${userUrls.slice(0, 5).join(", ")}`
        : "No user list JSON detected";
  }

  return {
    section: def.section,
    url: finalUrl,
    hasUsersApi,
    hasActiveStatus,
    usefulFields,
    notes,
    usefulResponsePath,
  };
}

async function main(): Promise<void> {
  ensureDirs();
  assertProfileExists();

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());
  const net = attachNetworkCollector(page);

  const conclusion: string[] = [];

  try {
    // --- Task 1: Users page network ---
    console.log("\n=== Task 1: Users page network ===");
    net.reset();
    await page.goto(USERS_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const usersNetwork = net.getEntries();
    fs.writeFileSync(
      path.join(DEBUG_DIR, "users-network.json"),
      JSON.stringify({ usersUrl: USERS_URL, captured: usersNetwork }, null, 2),
      "utf8",
    );

    const pageText = await page.locator("body").innerText();
    const pageSummary = parseActiveSummaryFromPageText(pageText);

    const bestUsersApi = pickBestUserList(usersNetwork);
    let apiAnalysis: ReturnType<typeof analyzeUserRecords> | null = null;

    if (bestUsersApi && bestUsersApi.items.length > 0) {
      fs.writeFileSync(
        path.join(DEBUG_DIR, "users-api-response.json"),
        JSON.stringify(
          {
            sourceUrl: bestUsersApi.sourceUrl,
            path: bestUsersApi.path,
            data: bestUsersApi.items,
          },
          null,
          2,
        ),
        "utf8",
      );
      apiAnalysis = analyzeUserRecords(bestUsersApi.items);
    }

    const usersApiSummary = {
      usersUrl: USERS_URL,
      pageActiveSummary: pageSummary,
      usersFromApi: apiAnalysis?.count ?? 0,
      apiSourceUrl: bestUsersApi?.sourceUrl ?? null,
      apiPath: bestUsersApi?.path ?? null,
      fields: apiAnalysis?.allFields ?? [],
      hasExplicitStatus: apiAnalysis?.hasExplicitStatus ?? false,
      statusFields: apiAnalysis?.statusFields ?? [],
      hasUserId: apiAnalysis?.hasUserId ?? false,
      hasEmailPhoneContacts: apiAnalysis?.hasContacts ?? false,
      canDistinguishActiveInactiveWithoutHeuristics:
        apiAnalysis?.canDistinguishActiveInactive ?? false,
      activeUserExample: apiAnalysis?.activeExample ?? null,
      inactiveUserExample: apiAnalysis?.inactiveExample ?? null,
      topUserRelatedUrls: usersNetwork
        .filter((e) => /user|member|staff|employee|linq/i.test(e.url))
        .map((e) => ({ method: e.method, url: e.url, status: e.status }))
        .slice(0, 30),
    };

    fs.writeFileSync(
      path.join(DEBUG_DIR, "users-api-summary.json"),
      JSON.stringify(usersApiSummary, null, 2),
      "utf8",
    );
    console.log("Saved users-network.json, users-api-summary.json");

    // --- Task 2: Scroll virtualization ---
    console.log("\n=== Task 2: Scroll users table ===");
    await scrollUsersTable(page);
    const allVisible = await parseUsersFromDom(page);
    fs.writeFileSync(
      path.join(DEBUG_DIR, "users-all-visible.json"),
      JSON.stringify(allVisible, null, 2),
      "utf8",
    );
    console.log(`Visible rows after scroll: ${allVisible.length}`);

    // --- Board assignees (for task 4) ---
    console.log("\n=== Board assignees (board 445) ===");
    net.reset();
    await openBoardWithReadiness(page, BOARD_URL);
    await page.waitForTimeout(2000);
    const boardNetwork = net.getEntries();
    const assignees = extractAssigneesFromBoardJson(boardNetwork);
    console.log(
      `Board assignees: userIds=${assignees.userIds.length} names=${assignees.names.length}`,
    );

    // --- Task 3: Menu sections ---
    console.log("\n=== Task 3: Menu sections ===");
    const sectionsSummary: Array<{
      section: string;
      url: string;
      hasUsersApi: boolean;
      hasActiveStatus: boolean;
      usefulFields: string[];
      notes: string;
      usefulResponsePath: string | null;
    }> = [];

    for (const def of SECTIONS) {
      console.log(`Section: ${def.section}`);
      const result = await probeSection(page, def, net);
      sectionsSummary.push(result);
    }

    fs.writeFileSync(
      path.join(SECTIONS_DIR, "sections-summary.json"),
      JSON.stringify(sectionsSummary, null, 2),
      "utf8",
    );

    // --- Task 4: Compare lists ---
    console.log("\n=== Task 4: Compare lists ===");
    const allApiUsers = bestUsersApi?.items ?? [];
    const allUsersNames = allApiUsers
      .map(displayNameFromApiUser)
      .filter(Boolean);
    const activeUsersNames = allApiUsers
      .filter((u) => isExplicitlyActiveUser(u) === true)
      .map(displayNameFromApiUser)
      .filter(Boolean);
    const inactiveUsersNames = allApiUsers
      .filter((u) => isExplicitlyActiveUser(u) === false)
      .map(displayNameFromApiUser)
      .filter(Boolean);

    const blockedFalseCount = allApiUsers.filter((u) => u.blocked === false).length;
    const blockedTrueCount = allApiUsers.filter((u) => u.blocked === true).length;

    const allUsersCount = allApiUsers.length;
    const activeUsersCount = blockedFalseCount;

    const apiById = new Map(
      allApiUsers
        .filter((u) => u.id !== undefined)
        .map((u) => [String(u.id), u]),
    );

    const assigneesNotInAllUsers: string[] = [];
    const assigneesNotInActiveUsers: string[] = [];
    const assigneesOnBlockedUsers: string[] = [];
    const matchedAssignees: string[] = [];

    for (const uid of assignees.userIds) {
      const user = apiById.get(uid);
      if (!user) {
        assigneesNotInAllUsers.push(`userId:${uid}`);
        continue;
      }
      const name = displayNameFromApiUser(user) || `userId:${uid}`;
      if (user.blocked === true) {
        assigneesOnBlockedUsers.push(name);
      } else if (user.blocked === false) {
        matchedAssignees.push(name);
      } else {
        assigneesNotInActiveUsers.push(name);
      }
    }

    const canDetectInactiveExactly =
      apiAnalysis?.hasExplicitStatus === true &&
      typeof allApiUsers[0]?.blocked === "boolean";

    const compareDiagnostic = {
      allUsersCount,
      activeUsersCount,
      inactiveUsersCount: blockedTrueCount,
      taskAssigneesCount: assignees.userIds.length,
      taskAssigneeNamesCount: assignees.names.length,
      apiUsersParsedCount: allApiUsers.length,
      domVisibleUsersCount: allVisible.length,
      canDetectInactiveExactly,
      statusFieldSemantics: {
        blocked: "blocked=true → restricted/blocked; blocked=false → active (77/101 matches UI)",
      },
      matchedAssignees,
      assigneesNotInActiveUsers,
      assigneesNotInAllUsers,
      assigneesOnBlockedUsers,
      explicitInactiveFromApi: inactiveUsersNames.slice(0, 30),
      risks: [
        "get_tasks.userList содержит userId, не ФИО — сравнение по id надёжнее, чем по имени",
        "Таблица users виртуализирована: DOM 40 строк, API 101 пользователь",
        "Поле blocked — явный признак ограничения; уточнить у заказчика: blocked = уволен или только заблокирован",
        "Учет времени: Выключен не является inactive",
        assignees.userIds.length === 0
          ? "На доске 445 в get_tasks нет assignees (userList пуст) — для compare нужна рабочая доска"
          : null,
      ].filter(Boolean) as string[],
    };

    fs.writeFileSync(
      path.join(DEBUG_DIR, "users-compare-diagnostic.json"),
      JSON.stringify(compareDiagnostic, null, 2),
      "utf8",
    );

    // --- Task 5: Conclusion ---
    console.log("\n=== Task 5: Conclusion ===");
    const foundUsersApi = Boolean(bestUsersApi && bestUsersApi.items.length > 0);
    const foundExplicitStatus = apiAnalysis?.hasExplicitStatus ?? false;
    const canExactRule = canDetectInactiveExactly;

    conclusion.push(
      `1. Users API found: ${foundUsersApi ? "yes" : "no"}${bestUsersApi ? ` (${bestUsersApi.items.length} records, ${bestUsersApi.sourceUrl})` : ""}`,
    );
    conclusion.push(
      foundExplicitStatus
        ? `2. Explicit active/inactive status: yes — fields: ${apiAnalysis?.statusFields.join(", ") ?? ""}`
        : `2. Explicit active/inactive status: no (only page text «${pageSummary.activeCount ?? "?"} из ${pageSummary.totalCount ?? "?"} активны»)`,
    );
    conclusion.push(
      `3. Exact rule «task assigned to blocked/inactive user»: ${canExactRule ? "possible via get_users.blocked + task userId" : "not yet"}`,
    );
    conclusion.push(
      `4. Best data sources: ${foundUsersApi ? "users API JSON" : "none yet"}, profile API (not probed), hierarchy section (${sectionsSummary.find((s) => s.section === "Иерархия")?.hasUsersApi ? "has user-like API" : "check sections-summary"}), compare assignees↔activeUsers (${activeUsersCount != null ? "partial" : "unavailable"})`,
    );
    conclusion.push(
      `5. Customer needs: ${canExactRule ? "confirm API endpoint + field mapping" : "confirm where inactive/disabled/fired flag lives, or provide HR export; do not infer from time tracking or «not in active list» alone"}`,
    );
    conclusion.push(
      `DOM after scroll: ${allVisible.length} rows; API users: ${allApiUsers.length} (active=${blockedFalseCount}, blocked=${blockedTrueCount}); board assignee userIds: ${assignees.userIds.length}`,
    );

    for (const line of conclusion) console.log(line);
  } finally {
    net.stop();
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
