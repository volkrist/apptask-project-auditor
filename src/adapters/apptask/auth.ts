import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { createLogger } from "./logger.js";

const log = createLogger("auth");

export const LOGIN_URL = "https://apptask.ru/login";

export const PERSISTENT_PROFILE_DIR = path.join(
  "playwright",
  ".user-data",
  "apptask",
);

export const CHROMIUM_LAUNCH_ARGS: string[] = [
  "--disable-blink-features=AutomationControlled",
  "--disable-dev-shm-usage",
  "--no-sandbox",
];

export type LaunchProfileOptions = {
  devtools?: boolean;
};

export function resolveUserDataDir(override?: string): string {
  return override ?? process.env.APPTASK_USER_DATA_DIR ?? PERSISTENT_PROFILE_DIR;
}

export function hasUserDataDir(dir = resolveUserDataDir()): boolean {
  return fs.existsSync(dir);
}

export function ensureProfileDir(userDataDir = resolveUserDataDir()): void {
  fs.mkdirSync(userDataDir, { recursive: true });
}

export function getLaunchArgs(devtools = false): string[] {
  const args = [...CHROMIUM_LAUNCH_ARGS];
  if (devtools) {
    args.push("--auto-open-devtools-for-tabs");
  }
  return args;
}

/**
 * Headed Chromium with a persistent profile (cookies, localStorage, WASM cache).
 */
export async function launchApptaskContext(
  options: LaunchProfileOptions = {},
  userDataDir = resolveUserDataDir(),
): Promise<BrowserContext> {
  ensureProfileDir(userDataDir);
  log.info(`launchPersistentContext → ${userDataDir}`);

  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: getLaunchArgs(options.devtools ?? false),
    viewport: { width: 1400, height: 900 },
    locale: "ru-RU",
  });
}

/**
 * Open login page and wait for manual sign-in. Profile is saved on close.
 */
export async function openManualLogin(
  options: LaunchProfileOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await launchApptaskContext(options);
  const page = context.pages()[0] ?? (await context.newPage());

  log.info(`Manual login: ${LOGIN_URL}`);
  await page.goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  return { context, page };
}

export function assertProfileExists(dir = resolveUserDataDir()): void {
  if (!hasUserDataDir(dir)) {
    throw new Error(
      `No persistent profile at ${dir}\n` +
        `Run: npm run auth:profile  (log in manually in the Playwright window)`,
    );
  }
}
