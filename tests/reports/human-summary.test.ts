import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { buildAuditResult } from "../../src/reports/build-audit-result.js";
import { writeAuditReports } from "../../src/reports/output.js";
import { buildHumanSummaryMarkdown } from "../../src/reports/human-summary.js";
import fs from "node:fs";
import os from "node:os";

const testConfig = loadAuditConfig({ linkCheckEnabled: false });
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): RawTask {
  return JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", name), "utf8"),
  ) as RawTask;
}

test("buildHumanSummaryMarkdown contains management sections without ruleId noise", async () => {
  const result = await buildAuditResult([loadFixture("task-bad.json")], testConfig, {
    projectName: "TurboWeave",
    boardUrl: "https://apptask.ru/c/7/board/783",
  });
  const md = buildHumanSummaryMarkdown(result);
  assert.match(md, /# Аудит TurboWeave — краткий отчёт/);
  assert.match(md, /## 2\. Главные риски/);
  assert.match(md, /## 3\. Топ задач для разбора/);
  assert.match(md, /audit-report\.md/);
  assert.doesNotMatch(md, /"ruleId"/);
  assert.doesNotMatch(md, /C:\\/);
  assert.doesNotMatch(md, /\{[\s\S]*"meta"/);
});

test("writeAuditReports creates contract audit-report only (no human-summary)", async () => {
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "audit-human-"));
  const result = await buildAuditResult([loadFixture("task-bad.json")], testConfig, {
    projectName: "Test",
    boardUrl: "https://example.com/board/1",
  });
  const paths = writeAuditReports(result, tmp);
  assert.ok(fs.existsSync(paths.reportPath));
  assert.ok(!fs.existsSync(paths.humanSummaryPath));
  const full = fs.readFileSync(paths.reportPath, "utf8");
  assert.match(full, /# Отчёт аудита AppTask/);
  assert.match(full, /## Результаты проверок/);
  assert.doesNotMatch(full, /## Краткий вывод/);
});
