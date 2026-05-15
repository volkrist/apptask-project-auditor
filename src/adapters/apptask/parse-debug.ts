import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createLogger } from "./logger.js";
import type { TaskRef } from "./task-ref.js";

const log = createLogger("parse-debug");

const DEBUG_DIR = path.join("output", "debug", "parse");

export type ParseFailureArtifacts = {
  screenshot?: string;
  html?: string;
  meta?: string;
};

export async function saveParseFailureArtifacts(
  page: Page,
  taskRef: TaskRef,
  step: string,
  errorMessage: string,
): Promise<ParseFailureArtifacts> {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const slug =
    taskRef.taskId ??
    (taskRef.titlePreview
      ? taskRef.titlePreview.slice(0, 24)
      : "unknown");
  const safeSlug = slug.replace(/[^\w.-]+/g, "_") || "task";
  const screenshotPath = path.join(DEBUG_DIR, `task-${safeSlug}.png`);
  const htmlPath = path.join(DEBUG_DIR, `task-${safeSlug}.html`);
  const metaPath = path.join(DEBUG_DIR, `task-${safeSlug}.json`);

  const artifacts: ParseFailureArtifacts = {
    screenshot: screenshotPath,
    html: htmlPath,
    meta: metaPath,
  };

  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      timeout: 15_000,
    });
  } catch (e) {
    log.warn(`screenshot: ${e instanceof Error ? e.message : e}`);
  }

  try {
    fs.writeFileSync(htmlPath, await page.content(), "utf8");
  } catch (e) {
    log.warn(`html: ${e instanceof Error ? e.message : e}`);
  }

  fs.writeFileSync(
    metaPath,
    JSON.stringify(
      {
        step,
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

  log.error(`parse failed at ${step}: ${errorMessage}`);
  log.error(`artifacts: ${JSON.stringify(artifacts)}`);

  return artifacts;
}
