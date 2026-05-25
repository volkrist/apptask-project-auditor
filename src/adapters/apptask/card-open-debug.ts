import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createLogger } from "./logger.js";
import type { TaskRef } from "./task-ref.js";

const log = createLogger("card:debug");
const DEBUG_DIR = path.join("output", "debug", "card-open");

export type CardOpenDebugArtifacts = {
  screenshot?: string;
  html?: string;
  meta?: string;
};

export async function saveCardOpenFailureArtifacts(
  page: Page,
  taskRef: TaskRef,
  phase: "direct-fail" | "click-fail",
  errorMessage: string,
): Promise<CardOpenDebugArtifacts> {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const id = taskRef.taskId ?? "unknown";
  const prefix = `${phase}-task-${id}`;
  const screenshotPath = path.join(DEBUG_DIR, `${prefix}.png`);
  const htmlPath = path.join(DEBUG_DIR, `${prefix}.html`);
  const metaPath = path.join(DEBUG_DIR, `${prefix}.json`);

  const artifacts: CardOpenDebugArtifacts = {
    screenshot: screenshotPath,
    html: htmlPath,
    meta: metaPath,
  };

  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      timeout: 10_000,
    });
  } catch (e) {
    log.info(`screenshot: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf8");
  } catch (e) {
    log.info(`html: ${e instanceof Error ? e.message : String(e)}`);
  }

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        phase,
        error: errorMessage,
        taskRef,
        url: page.url(),
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  return artifacts;
}
