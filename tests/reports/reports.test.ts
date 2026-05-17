import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";

const testConfig = loadAuditConfig({ linkCheckEnabled: false });
import {
  buildAuditResult,
  buildTopIssues,
} from "../../src/reports/build-audit-result.js";
import {
  buildDiscordSummary,
  truncateDiscordSummary,
  DISCORD_SUMMARY_MAX_LENGTH,
} from "../../src/reports/discord-summary.js";
import { buildDetailMarkdown } from "../../src/reports/markdown.js";
import { buildSummaryMarkdown } from "../../src/reports/summary-markdown.js";
import { writeAuditReports } from "../../src/reports/output.js";
import fs from "node:fs";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): RawTask {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", name), "utf8"),
  ) as RawTask;
}

test("buildTopIssues считает нарушения по ruleId", async () => {
  const good = loadFixture("task-good.json");
  const bad = loadFixture("task-bad.json");
  const result = await buildAuditResult([good, bad], testConfig, {
    projectName: "Test",
    boardUrl: "https://example.com/board/1",
  });

  assert.ok(result.topIssues.length > 0);
  assert.ok(result.meta.failCount > 0);
  const assignee = result.topIssues.find((i) => i.ruleId === "assignee_present");
  assert.ok(assignee && assignee.count >= 1);
});

test("buildDiscordSummary не превышает лимит", async () => {
  const result = await buildAuditResult([loadFixture("task-bad.json")], testConfig, {
    projectName: "Test",
    boardUrl: "https://example.com/board/1",
  });
  const text = buildDiscordSummary(result);
  assert.ok(text.length <= DISCORD_SUMMARY_MAX_LENGTH + 50);
});

test("truncateDiscordSummary сокращает длинный текст", () => {
  const long = "а".repeat(3000);
  const out = truncateDiscordSummary(long, 100);
  assert.ok(out.length <= 100);
  assert.match(out, /сокращено/);
});

test("writeAuditReports создаёт json и markdown", async () => {
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "audit-test-"));
  const result = await buildAuditResult([loadFixture("task-good.json")], testConfig, {
    projectName: "Test",
    boardUrl: "https://example.com/board/1",
  });
  const paths = writeAuditReports(result, tmp);
  assert.ok(fs.existsSync(paths.jsonPath));
  assert.ok(fs.existsSync(paths.markdownPath));
  assert.ok(fs.existsSync(paths.summaryPath));
  const md = fs.readFileSync(paths.markdownPath, "utf8");
  assert.match(md, /Детальный отчёт/);
  const summary = buildSummaryMarkdown(result);
  assert.match(summary, /Аудит/);
  assert.match(buildDetailMarkdown(result), /Карточки/);
});
