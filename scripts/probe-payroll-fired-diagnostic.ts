/**
 * Payroll report diagnostic: «Отчёты → Зарплатный» → block «Уволены» vs users API blocked.
 * Does not change rules, parser, reports, Discord, or profile path.
 *
 * Run: npm run probe:payroll:fired
 * Optional: APPTASK_PAYROLL_REPORT_URL — direct URL if menu navigation fails
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Response } from "@playwright/test";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import {
  loadAppTaskUsers,
  type AppTaskUser,
} from "../src/users/app-task-users.js";

const DEBUG_DIR = path.join("output", "debug");
const OUT_NETWORK = path.join(DEBUG_DIR, "payroll-fired-network.json");
const OUT_FIRED_USERS = path.join(DEBUG_DIR, "payroll-fired-users.json");
const OUT_SUMMARY = path.join(DEBUG_DIR, "payroll-fired-summary.json");
const OUT_PAGE_TEXT = path.join(DEBUG_DIR, "payroll-page-text.txt");
const OUT_PAGE_HTML = path.join(DEBUG_DIR, "payroll-page.html");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOM_PARSE_PATH = path.join(SCRIPT_DIR, "probe-payroll-fired-dom.parse.js");

const BOARD_URL =
  process.env.APPTASK_BOARD_URL?.trim() ??
  "https://apptask.ru/c/7/board/445";
const USERS_URL =
  process.env.APPTASK_USERS_URL?.trim() ??
  "https://apptask.ru/c/7/settings/users";
const PAYROLL_URL_DEFAULT =
  "https://apptask.ru/c/7/reports/payment";
const PAYROLL_URL_ENV = process.env.APPTASK_PAYROLL_REPORT_URL?.trim();

const FIRED_GROUP_RE = /уволен/i;
const INACTIVE_GROUP_RE = /уволен|не\s*работа/i;

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

export type PayrollFiredUser = {
  name: string;
  userId: string | null;
  email: string | null;
  sourcePath: string;
  sourceUrl: string;
  rawKeys: string[];
};

type FiredGroupHit = {
  groupLabel: string;
  path: string;
  sourceUrl: string;
  members: unknown[];
};

function ensureDirs(): void {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
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

function isGroupLabel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return FIRED_GROUP_RE.test(value.trim());
}

function pickNameFromRecord(row: Record<string, unknown>): string {
  const candidates = [
    row.realName,
    row.fullName,
    row.name,
    row.userName,
    row.displayName,
    row.fio,
    row.title,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  const first = row.firstName;
  const last = row.lastName;
  if (typeof first === "string" || typeof last === "string") {
    return [first, last].filter((x) => typeof x === "string").join(" ").trim();
  }
  return "";
}

function pickUserId(row: Record<string, unknown>): string | null {
  for (const key of ["userId", "user_id", "id", "profileId", "profile_id"]) {
    const v = row[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "number" || typeof v === "string") return String(v);
  }
  return null;
}

function pickEmail(row: Record<string, unknown>): string | null {
  const v = row.email;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function membersLookLikeUsers(members: unknown[]): boolean {
  if (members.length === 0) return false;
  const sample = members.slice(0, 3).filter((m) => m && typeof m === "object");
  if (sample.length === 0) return false;
  return sample.some((m) => {
    const name = pickNameFromRecord(m as Record<string, unknown>);
    return name.length >= 3;
  });
}

function findFiredGroupsByFiredKeys(
  value: unknown,
  path = "",
  sourceUrl: string,
  hits: FiredGroupHit[] = [],
): FiredGroupHit[] {
  if (hits.length > 30 || value === null || value === undefined) return hits;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      findFiredGroupsByFiredKeys(value[i], `${path}[${i}]`, sourceUrl, hits);
    }
    return hits;
  }
  if (typeof value !== "object") return hits;
  const obj = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (/fired|dismiss|уволен|terminated|removed/i.test(key)) {
      if (Array.isArray(child) && membersLookLikeUsers(child)) {
        hits.push({
          groupLabel: key,
          path: childPath,
          sourceUrl,
          members: child,
        });
      }
    }
    findFiredGroupsByFiredKeys(child, childPath, sourceUrl, hits);
  }
  return hits;
}

function findFiredGroups(
  value: unknown,
  path = "",
  sourceUrl: string,
  hits: FiredGroupHit[] = [],
): FiredGroupHit[] {
  if (hits.length > 30 || value === null || value === undefined) return hits;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      findFiredGroups(value[i], `${path}[${i}]`, sourceUrl, hits);
    }
    return hits;
  }

  if (typeof value !== "object") return hits;

  const obj = value as Record<string, unknown>;

  const labelCandidates = [
    obj.title,
    obj.name,
    obj.groupName,
    obj.groupTitle,
    obj.sectionTitle,
    obj.label,
    obj.type,
    obj.status,
    obj.category,
  ];

  const groupLabel = labelCandidates.find((v) => isGroupLabel(v)) as string | undefined;

  const memberKeys = [
    "users",
    "userList",
    "members",
    "employees",
    "staff",
    "items",
    "list",
    "data",
    "rows",
    "people",
    "linq",
  ];

  if (groupLabel) {
    for (const key of memberKeys) {
      const arr = obj[key];
      if (Array.isArray(arr) && membersLookLikeUsers(arr)) {
        hits.push({
          groupLabel: String(groupLabel),
          path: path ? `${path}.${key}` : key,
          sourceUrl,
          members: arr,
        });
      }
    }
  }

  for (const [key, child] of Object.entries(obj)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isGroupLabel(key) && Array.isArray(child) && membersLookLikeUsers(child)) {
      hits.push({
        groupLabel: key,
        path: childPath,
        sourceUrl,
        members: child,
      });
    }
    findFiredGroups(child, childPath, sourceUrl, hits);
  }

  return hits;
}

function mapMembersToFiredUsers(hit: FiredGroupHit): PayrollFiredUser[] {
  const out: PayrollFiredUser[] = [];
  const seen = new Set<string>();

  for (const raw of hit.members) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = pickNameFromRecord(row);
    if (!name || name.length < 2) continue;
    const key = normalizeName(name);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      userId: pickUserId(row),
      email: pickEmail(row),
      sourcePath: hit.path,
      sourceUrl: hit.sourceUrl,
      rawKeys: Object.keys(row).sort(),
    });
  }

  return out;
}

function pickBestFiredGroup(hits: FiredGroupHit[]): FiredGroupHit | null {
  if (hits.length === 0) return null;
  return hits
    .slice()
    .sort((a, b) => {
      const score = (h: FiredGroupHit) => {
        let s = h.members.length;
        if (FIRED_GROUP_RE.test(h.groupLabel)) s += 50;
        if (/payroll|salary|wage|зарплат|report|отчет|отчёт/i.test(h.sourceUrl)) s += 20;
        return s;
      };
      return score(b) - score(a);
    })[0]!;
}

async function openPayrollReport(page: Page): Promise<{
  finalUrl: string;
  navigation: string;
}> {
  const targetUrl = PAYROLL_URL_ENV ?? PAYROLL_URL_DEFAULT;

  await page.goto(BOARD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1000);

  const payrollLink = page.locator(
    'a.main-menu__item[href*="/reports/payment"], a[title="Зарплатный отчет"]',
  ).first();

  if (await payrollLink.isVisible().catch(() => false)) {
    const reportsToggle = page.locator(
      'button[data-menu="menu-reporting"], button.main-menu__item:has-text("Отчёты")',
    ).first();
    await reportsToggle.click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await payrollLink.click({ timeout: 12_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(2500);
    if (page.url().includes("/reports/payment")) {
      return { finalUrl: page.url(), navigation: "menu Отчёты → Зарплатный (/reports/payment)" };
    }
  }

  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  return {
    finalUrl: page.url(),
    navigation: PAYROLL_URL_ENV
      ? "env APPTASK_PAYROLL_REPORT_URL"
      : `goto ${PAYROLL_URL_DEFAULT}`,
  };
}

async function interactFiredSection(page: Page): Promise<void> {
  const fired = page.locator('text=/Уволен/i').first();
  if (await fired.isVisible().catch(() => false)) {
    await fired.scrollIntoViewIfNeeded().catch(() => {});
    await fired.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(2000);
}

async function extractFiredFromDom(page: Page): Promise<{
  firedNames: string[];
  hasFiredHeading: boolean;
  snippetAroundFired: string | null;
}> {
  await page.addScriptTag({ path: DOM_PARSE_PATH }).catch(() => {});
  const result = await page.evaluate(() => {
    // @ts-expect-error injected script
    return typeof extractFiredFromDom === "function" ? extractFiredFromDom() : null;
  });
  if (!result) {
    return { firedNames: [], hasFiredHeading: false, snippetAroundFired: null };
  }
  return {
    firedNames: result.firedNames ?? [],
    hasFiredHeading: Boolean(result.hasFiredHeading),
    snippetAroundFired: result.snippetAroundFired ?? null,
  };
}

function firedUsersFromNames(
  names: string[],
  source: string,
  pageUrl: string,
): PayrollFiredUser[] {
  return names.map((name) => ({
    name,
    userId: null,
    email: null,
    sourcePath: source,
    sourceUrl: pageUrl,
    rawKeys: ["domName"],
  }));
}

function extractPaymentApiRows(
  entries: CapturedNet[],
): Array<{ userId: string; email: string | null; totalTime: number }> {
  const entry = entries.find((e) =>
    /get_tracking_payment_summary/i.test(e.url),
  );
  if (!entry?.jsonBody || typeof entry.jsonBody !== "object") return [];

  const body = entry.jsonBody as Record<string, unknown>;
  const top = body.data;
  if (!Array.isArray(top) || !top[0] || typeof top[0] !== "object") return [];

  const inner = (top[0] as Record<string, unknown>).data;
  if (!Array.isArray(inner)) return [];

  const rows: Array<{ userId: string; email: string | null; totalTime: number }> =
    [];
  for (const item of inner) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const user = row.user as Record<string, unknown> | undefined;
    if (!user || user.id === undefined) continue;
    rows.push({
      userId: String(user.id),
      email: typeof user.email === "string" ? user.email : null,
      totalTime: typeof row.totalTime === "number" ? row.totalTime : 0,
    });
  }
  return rows;
}

function crossRefBlockedInPaymentApi(
  paymentRows: Array<{ userId: string; email: string | null; totalTime: number }>,
  appTaskUsers: AppTaskUser[],
): PayrollFiredUser[] {
  const blockedById = new Map(
    appTaskUsers
      .filter((u) => u.blocked)
      .map((u) => [String(u.id), u]),
  );
  const out: PayrollFiredUser[] = [];
  for (const row of paymentRows) {
    const user = blockedById.get(row.userId);
    if (!user) continue;
    out.push({
      name: user.realName,
      userId: row.userId,
      email: row.email ?? user.email ?? null,
      sourcePath: "api:get_tracking_payment_summary + get_users.blocked",
      sourceUrl: "https://host2201.apptask.ru/TimeTracker/get_tracking_payment_summary",
      rawKeys: ["user.id", "user.email", "totalTime", "blocked"],
    });
  }
  return out;
}

function extractFiredFromPaymentApi(
  entries: CapturedNet[],
): { users: PayrollFiredUser[]; note: string } | null {
  const entry = entries.find((e) =>
    /get_tracking_payment_summary/i.test(e.url),
  );
  if (!entry?.jsonBody || typeof entry.jsonBody !== "object") return null;

  const body = entry.jsonBody as Record<string, unknown>;
  const top = body.data;
  if (!Array.isArray(top)) return null;

  const fired: PayrollFiredUser[] = [];
  for (const group of top) {
    if (!group || typeof group !== "object") continue;
    const g = group as Record<string, unknown>;
    const label = [g.title, g.name, g.groupName, g.type, g.status]
      .filter((v) => typeof v === "string")
      .join(" ");
    if (!FIRED_GROUP_RE.test(label)) continue;

    const members = g.data;
    if (!Array.isArray(members)) continue;
    for (const m of members) {
      if (!m || typeof m !== "object") continue;
      const row = m as Record<string, unknown>;
      const user = row.user as Record<string, unknown> | undefined;
      const name = user ? pickNameFromRecord(user) : pickNameFromRecord(row);
      if (!name) continue;
      fired.push({
        name,
        userId: user ? pickUserId(user) : pickUserId(row),
        email: user ? pickEmail(user) : pickEmail(row),
        sourcePath: "data[].data[] (payment summary group)",
        sourceUrl: entry.url,
        rawKeys: Object.keys(row).sort(),
      });
    }
  }

  if (fired.length === 0) {
    return {
      users: [],
      note: "get_tracking_payment_summary has no labeled «Уволены» group in JSON",
    };
  }
  return { users: fired, note: "from payment summary API group label" };
}

function compareBlockedWithFired(
  blockedUsers: AppTaskUser[],
  firedUsers: PayrollFiredUser[],
): {
  blockedCount: number;
  firedCount: number;
  matchedByName: string[];
  matchedByUserId: string[];
  onlyInBlocked: Array<{ id: string; realName: string }>;
  onlyInFired: PayrollFiredUser[];
  blockedHasUserId: boolean;
  firedHasUserId: boolean;
  namesMatchRate: number | null;
} {
  const blocked = blockedUsers.filter((u) => u.blocked === true);
  const blockedById = new Map(blocked.map((u) => [String(u.id), u]));
  const blockedByName = new Map(
    blocked.map((u) => [normalizeName(u.realName), u]),
  );

  const matchedByName: string[] = [];
  const matchedByUserId: string[] = [];
  const firedMatched = new Set<string>();

  for (const f of firedUsers) {
    if (f.userId && blockedById.has(f.userId)) {
      matchedByUserId.push(f.name);
      firedMatched.add(normalizeName(f.name));
      continue;
    }
    const bn = blockedByName.get(normalizeName(f.name));
    if (bn) {
      matchedByName.push(f.name);
      firedMatched.add(normalizeName(f.name));
    }
  }

  const onlyInFired = firedUsers.filter(
    (f) => !firedMatched.has(normalizeName(f.name)),
  );
  const onlyInBlocked = blocked
    .filter((u) => !firedMatched.has(normalizeName(u.realName)))
    .map((u) => ({ id: String(u.id), realName: u.realName }));

  const union = new Set([
    ...blocked.map((u) => normalizeName(u.realName)),
    ...firedUsers.map((f) => normalizeName(f.name)),
  ]);
  const intersection = matchedByName.length + matchedByUserId.length;

  return {
    blockedCount: blocked.length,
    firedCount: firedUsers.length,
    matchedByName,
    matchedByUserId,
    onlyInBlocked,
    onlyInFired,
    blockedHasUserId: blocked.every((u) => u.id !== undefined && u.id !== null),
    firedHasUserId: firedUsers.some((f) => f.userId !== null),
    namesMatchRate:
      union.size > 0 ? Math.round((intersection / union.size) * 1000) / 10 : null,
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
    console.log("=== Payroll fired diagnostic ===\n");

    net.reset();
    const nav = await openPayrollReport(page);
    console.log(`Navigation: ${nav.navigation}`);
    console.log(`Page URL: ${nav.finalUrl}`);

    await interactFiredSection(page);

    const pageText = await page.locator("body").innerText().catch(() => "");
    fs.writeFileSync(OUT_PAGE_TEXT, pageText, "utf8");
    const pageHtml =
      (await page.locator("main").first().innerHTML().catch(() => null)) ??
      (await page.locator("body").innerHTML().catch(() => ""));
    fs.writeFileSync(OUT_PAGE_HTML, pageHtml, "utf8");

    const domFired = await extractFiredFromDom(page);
    if (domFired.hasFiredHeading) {
      console.log("DOM: inactive/fired section heading found");
    }
    if (domFired.firedNames.length > 0) {
      console.log(`DOM: ${domFired.firedNames.length} names in inactive section`);
    }

    const payrollEntries = net.getEntries();
    fs.writeFileSync(
      OUT_NETWORK,
      JSON.stringify(
        {
          pageUrl: nav.finalUrl,
          navigation: nav.navigation,
          capturedAt: new Date().toISOString(),
          entryCount: payrollEntries.length,
          captured: payrollEntries,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`Network saved: ${OUT_NETWORK} (${payrollEntries.length} entries)`);

    const allHits: FiredGroupHit[] = [];
    for (const entry of payrollEntries) {
      if (entry.bodyKind !== "json" || !entry.jsonBody) continue;
      findFiredGroups(entry.jsonBody, "", entry.url, allHits);
      findFiredGroupsByFiredKeys(entry.jsonBody, "", entry.url, allHits);
    }

    const bestGroup = pickBestFiredGroup(allHits);
    let firedUsers: PayrollFiredUser[] = [];
    let extractionSource = "";

    if (bestGroup) {
      firedUsers = mapMembersToFiredUsers(bestGroup);
      extractionSource = `api:${bestGroup.groupLabel}`;
      console.log(
        `API fired group: "${bestGroup.groupLabel}" at ${bestGroup.path} (${firedUsers.length} users)`,
      );
      console.log(`Source API: ${bestGroup.sourceUrl}`);
    }

    const paymentApi = extractFiredFromPaymentApi(payrollEntries);
    if (paymentApi?.users.length) {
      firedUsers = paymentApi.users;
      extractionSource = "api:payment_summary_group";
    } else if (paymentApi?.note) {
      console.log(paymentApi.note);
    }

    if (firedUsers.length === 0 && domFired.firedNames.length > 0) {
      firedUsers = firedUsersFromNames(
        domFired.firedNames,
        "dom:Уволены_section",
        nav.finalUrl,
      );
      extractionSource = "dom:Уволены_section";
      console.log(`Using DOM list: ${firedUsers.length} names`);
    }

    if (firedUsers.length === 0) {
      console.warn("No «Уволены» list extracted (API or DOM)");
      if (domFired.snippetAroundFired) {
        console.log("DOM snippet:", domFired.snippetAroundFired.slice(0, 300));
      }
    }

    console.log("\n=== Users API (blocked) ===");
    net.reset();
    const appTaskUsers = await loadAppTaskUsers(page, USERS_URL);
    const blockedUsers = appTaskUsers.filter((u) => u.blocked === true);
    console.log(`get_users: total=${appTaskUsers.length} blocked=${blockedUsers.length}`);

    const paymentRows = extractPaymentApiRows(payrollEntries);
    const blockedInPaymentApi = crossRefBlockedInPaymentApi(
      paymentRows,
      appTaskUsers,
    );
    console.log(
      `Payment API: ${paymentRows.length} rows, blocked ids in API: ${blockedInPaymentApi.length}`,
    );

    const domInactiveNote =
      firedUsers.length > 0 && extractionSource.startsWith("dom")
        ? "DOM section is «Не работали» / similar — not the same as users.blocked"
        : null;

    const compare = compareBlockedWithFired(appTaskUsers, firedUsers);
    const compareBlockedVsPaymentApi = {
      blockedInPaymentApiCount: blockedInPaymentApi.length,
      blockedUsersCount: blockedUsers.length,
      allBlockedPresentInPaymentApi:
        blockedInPaymentApi.length === blockedUsers.length,
      paymentApiHasUserId: true,
      paymentApiHasRealNameInJson: false,
    };

    const blockedCanBeExactSource =
      firedUsers.length > 0 &&
      compare.onlyInBlocked.length === 0 &&
      compare.onlyInFired.length === 0;

    const blockedMostlyMatchesFired =
      firedUsers.length > 0 &&
      compare.matchedByName.length + compare.matchedByUserId.length >=
        Math.min(compare.blockedCount, compare.firedCount) * 0.9;

    const uvolenyGroupFound = allHits.some((h) => FIRED_GROUP_RE.test(h.groupLabel));

    const summary = {
      generatedAt: new Date().toISOString(),
      payrollPageUrl: nav.finalUrl,
      payrollNavigation: nav.navigation,
      extractionSource: extractionSource || null,
      uvolenyGroupInApi: uvolenyGroupFound,
      domInactiveSection: {
        found: domFired.hasFiredHeading,
        namesCount: domFired.firedNames.length,
        note:
          "On Appfox tenant the table subhead is «Не работали», not «Уволены»; 40 names with 0h in period ≠ blocked users",
      },
      compareBlockedVsPaymentApi,
      blockedInPaymentApiSample: blockedInPaymentApi.slice(0, 8).map((u) => ({
        name: u.name,
        userId: u.userId,
      })),
      artifacts: {
        network: OUT_NETWORK,
        firedUsers: OUT_FIRED_USERS,
        pageText: OUT_PAGE_TEXT,
        pageHtml: OUT_PAGE_HTML,
      },
      keyApis: payrollEntries
        .filter((e) => /TimeTracker|payment|report/i.test(e.url))
        .map((e) => ({ method: e.method, url: e.url, status: e.status })),
      networkEntries: payrollEntries.length,
      firedGroupFound: Boolean(bestGroup),
      firedGroupLabel: bestGroup?.groupLabel ?? null,
      firedApiUrl: bestGroup?.sourceUrl ?? null,
      firedUsersCount: firedUsers.length,
      usersApiTotal: appTaskUsers.length,
      usersApiBlockedCount: compare.blockedCount,
      compare,
      payrollFiredHasUserId: compare.firedHasUserId,
      usersApiHasUserId: compare.blockedHasUserId,
      blockedMatchesFiredGroup:
        firedUsers.length === 0
          ? null
          : {
              exactSetMatch: blockedCanBeExactSource,
              mostlyMatches: blockedMostlyMatchesFired,
              matchedByNameCount: compare.matchedByName.length,
              matchedByUserIdCount: compare.matchedByUserId.length,
              onlyInBlockedCount: compare.onlyInBlocked.length,
              onlyInFiredCount: compare.onlyInFired.length,
              namesMatchRatePercent: compare.namesMatchRate,
            },
      canUseBlockedAsExactSource: {
        verdict: uvolenyGroupFound
          ? compare.exactNameMatch
            ? "yes — API «Уволены» matches blocked by name"
            : "partial — review compare"
          : compareBlockedVsPaymentApi.allBlockedPresentInPaymentApi
            ? "yes for audit — use get_users.blocked; payroll has no «Уволены» label and hides blocked users in UI"
            : "yes — prefer get_users.blocked (payroll has no fired group)",
        note: "Payroll «Не работали» = zero hours in period, not fired. blocked users are in payment JSON but not in visible table.",
      },
      assigneeMatchingImplication: {
        payrollProvidesUserId: compare.firedHasUserId,
        usersApiProvidesUserId: true,
        recommendation: compare.firedHasUserId
          ? "Prefer users API blocked + task userId; payroll confirms fired list"
          : "Payroll «Уволены» is name-only — keep users API blocked + userId/name fallback for rules",
      },
      sampleOnlyInBlocked: compare.onlyInBlocked.slice(0, 10),
      sampleOnlyInFired: compare.onlyInFired.slice(0, 10),
      risks: [
        !uvolenyGroupFound
          ? "No «Уволены» group in API/DOM on /reports/payment — only «Не работали»"
          : null,
        domInactiveNote,
        compare.matchedByName.length === 0 && firedUsers.length > 0
          ? "DOM inactive list does not match blocked=true (different semantics)"
          : null,
        !compare.firedHasUserId
          ? "Payroll DOM list is name-only; payment API has userId but not realName"
          : null,
      ].filter(Boolean),
    };

    fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n=== Summary ===");
    console.log(
      `Fired (payroll): ${compare.firedCount} | Blocked (users API): ${compare.blockedCount}`,
    );
    console.log(
      `«Уволены» in API: ${uvolenyGroupFound ? "yes" : "no"} | DOM inactive names: ${domFired.firedNames.length}`,
    );
    console.log(
      `blocked in payment API (by userId): ${blockedInPaymentApi.length}/${blockedUsers.length}`,
    );
    if (firedUsers.length > 0) {
      console.log(
        `DOM/API inactive list vs blocked: matched=${compare.matchedByName.length}, only blocked=${compare.onlyInBlocked.length}, only payroll=${compare.onlyInFired.length}`,
      );
    }
    console.log(`Use blocked as source: ${summary.canUseBlockedAsExactSource.verdict}`);
    console.log(`Full summary: ${OUT_SUMMARY}`);

    conclusion.push(
      `Payroll «Уволены» group: ${uvolenyGroupFound ? "found" : "not found"} (DOM inactive section: ${domFired.firedNames.length} names, label «Не работали»)`,
    );
    conclusion.push(
      `Users API blocked=true: ${compare.blockedCount} users`,
    );
    conclusion.push(
      `blocked vs payroll inactive names: matched=${compare.matchedByName.length} (0 expected — different semantics)`,
    );
    conclusion.push(
      `blocked in payment API by userId: ${blockedInPaymentApi.length}/${compare.blockedCount}`,
    );
    conclusion.push(summary.canUseBlockedAsExactSource.verdict);
    conclusion.push(
      "Assignee check: users API blocked + userId/name; payroll report is not a fired-employee registry",
    );

    fs.writeFileSync(
      OUT_FIRED_USERS,
      JSON.stringify(
        {
          extractedAt: new Date().toISOString(),
          pageUrl: nav.finalUrl,
          extractionSource: extractionSource || null,
          uvolenyGroupFound: uvolenyGroupFound,
          dom: {
            hasFiredHeading: domFired.hasFiredHeading,
            inactiveSectionNames: domFired.firedNames,
            snippetAroundFired: domFired.snippetAroundFired,
          },
          group: bestGroup
            ? {
                label: bestGroup.groupLabel,
                path: bestGroup.path,
                sourceUrl: bestGroup.sourceUrl,
                memberCount: bestGroup.members.length,
              }
            : null,
          paymentApiNote: paymentApi?.note ?? null,
          allGroupHits: allHits.map((h) => ({
            groupLabel: h.groupLabel,
            path: h.path,
            sourceUrl: h.sourceUrl,
            memberCount: h.members.length,
          })),
          users: firedUsers,
          blockedInPaymentApi,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`Fired users saved: ${OUT_FIRED_USERS}`);

    for (const line of conclusion) console.log(`→ ${line}`);
  } finally {
    net.stop();
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
