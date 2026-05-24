/**
 * Diagnostic: AppTask «Пользователи» — DOM snapshot + table parse attempt.
 * Does not change audit, rules, or parser.
 *
 * Run: npm run debug:users
 * Requires: APPTASK_USERS_URL in .env
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../adapters/apptask/auth.js";

const DEBUG_DIR = path.join("output", "debug");
const OUT_PNG = path.join(DEBUG_DIR, "users-page.png");
const OUT_HTML = path.join(DEBUG_DIR, "users-page.html");
const OUT_TEXT = path.join(DEBUG_DIR, "users-page-text.txt");
const OUT_SAMPLE = path.join(DEBUG_DIR, "users-sample.json");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PARSE_SCRIPT_PATH = path.join(SCRIPT_DIR, "debug-users-page.parse.js");

export type UserRowSample = {
  fullName: string;
  role: string;
  projectsCount: string;
  timeTrackingStatus: string;
  profileUrl: string | null;
  visibleStatusText: string | null;
  isActive: boolean | null;
};

function requireUsersUrl(): string {
  const url = process.env.APPTASK_USERS_URL?.trim();
  if (!url) {
    console.error("APPTASK_USERS_URL is not set in .env");
    console.error("Example: APPTASK_USERS_URL=https://apptask.ru/c/7/users");
    process.exit(1);
  }
  return url;
}

function ensureDebugDir(): void {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

async function waitForUsersPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const readySelectors = [
    ".flex-table--users .flex-table__body .flex-table__row",
    ".users-page-content",
    "table tbody tr",
    "main",
    "body",
  ];
  for (const selector of readySelectors) {
    const loc = page.locator(selector).first();
    try {
      await loc.waitFor({ state: "visible", timeout: 12_000 });
      break;
    } catch {
      /* try next */
    }
  }

  await page.waitForTimeout(1000);
}

async function parseUsersFromDom(page: Page): Promise<UserRowSample[]> {
  await page.addScriptTag({ path: PARSE_SCRIPT_PATH });
  return page.evaluate("window.parseUsersInPage()") as Promise<UserRowSample[]>;
}

async function main(): Promise<void> {
  ensureDebugDir();
  assertProfileExists();

  const usersUrl = requireUsersUrl();
  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    console.log("Opening users page:", usersUrl);
    await waitForUsersPage(page, usersUrl);

    const contentRoot =
      (await page.locator(".users-page-content").first().count()) > 0
        ? page.locator(".users-page-content").first()
        : page.locator("main").first();
    const html = await contentRoot.innerHTML().catch(async () =>
      page.locator("body").innerHTML(),
    );
    const text = await page.locator("body").innerText();

    await page.screenshot({ path: OUT_PNG, fullPage: true });
    fs.writeFileSync(OUT_HTML, html, "utf8");
    fs.writeFileSync(OUT_TEXT, text, "utf8");

    const users = await parseUsersFromDom(page);
    fs.writeFileSync(OUT_SAMPLE, JSON.stringify(users, null, 2), "utf8");

    console.log(`Page URL: ${page.url()}`);
    if (/страница не найдена|404/i.test(text)) {
      console.warn(
        "Page looks like 404 — set APPTASK_USERS_URL to the exact «Пользователи» URL from AppTask (copy from browser address bar).",
      );
    }
    console.log(`Parsed user rows: ${users.length}`);
    console.log("Saved:", OUT_PNG, OUT_HTML, OUT_TEXT, OUT_SAMPLE);

    if (users.length > 0) {
      console.log("Sample (first 3):");
      console.log(JSON.stringify(users.slice(0, 3), null, 2));
    } else {
      console.warn(
        "No user rows parsed — inspect users-page.html / users-page-text.txt",
      );
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
