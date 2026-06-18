import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildReportAttachments } from "../../src/discord/publish-report.js";
import type { RunAuditResult } from "../../src/app/run-audit.js";

test("buildReportAttachments attaches only audit-report.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-attach-"));
  const reportPath = path.join(dir, "audit-report.md");
  fs.writeFileSync(reportPath, "# report", "utf8");

  const out = {
    result: { meta: { projectName: "X", boardUrl: "u", auditedAt: "", cardsChecked: 1, failCount: 0, warnCount: 0 }, topIssues: [], cards: [] },
    output: {
      dir,
      jsonPath: path.join(dir, "audit.json"),
      markdownPath: path.join(dir, "audit.md"),
      summaryPath: path.join(dir, "summary.md"),
      reportPath,
      humanSummaryPath: path.join(dir, "human-summary.md"),
    },
    totalOnBoard: 1,
    discordPublished: false,
  } as RunAuditResult;

  const files = buildReportAttachments(out);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.name, "audit-report.md");
});
