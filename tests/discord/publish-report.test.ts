import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildReportAttachments } from "../../src/discord/publish-report.js";
import type { RunAuditResult } from "../../src/app/run-audit.js";

test("buildReportAttachments attaches audit-report.html only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-attach-"));
  const reportPath = path.join(dir, "audit-report.md");
  fs.writeFileSync(reportPath, "# report", "utf8");

  const out = {
    result: { meta: { projectName: "X", boardUrl: "u", auditedAt: "", cardsChecked: 1, failCount: 0, warnCount: 0 }, topIssues: [], cards: [] },
    output: {
      dir,
      runId: "audit-test",
      jsonPath: path.join(dir, "audit.json"),
      markdownPath: path.join(dir, "audit.md"),
      summaryPath: path.join(dir, "summary.md"),
      reportPath,
      htmlPath: path.join(dir, "audit-report.html"),
      humanSummaryPath: path.join(dir, "human-summary.md"),
    },
    totalOnBoard: 1,
    discordPublished: false,
    ignoredCount: 0,
    ignoredUrls: [],
  } as RunAuditResult;

  fs.writeFileSync(out.output.htmlPath, "<html></html>", "utf8");

  const files = buildReportAttachments(out);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.name, "audit-report.html");
});
