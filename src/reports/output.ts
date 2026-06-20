import fs from "node:fs";
import path from "node:path";
import type { AuditResult } from "../rules/rule-types.js";
import { buildDetailJson } from "./json.js";
import { buildDetailMarkdown } from "./markdown.js";
import { buildSummaryMarkdown } from "./summary-markdown.js";
import { buildContractAuditMarkdown } from "./contract-audit-markdown.js";
import { buildContractAuditHtml } from "./build-html-report.js";
import { buildExampleEvidenceResults } from "./build-evidence-result.js";
import { auditRunIdFromDir } from "./report-web-url.js";

export type AuditOutputPaths = {
  dir: string;
  runId: string;
  jsonPath: string;
  markdownPath: string;
  summaryPath: string;
  reportPath: string;
  htmlPath: string;
  humanSummaryPath: string;
};

function formatAuditDirName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

export function createAuditOutputDir(baseDir = path.join("output")): string {
  const dir = path.join(baseDir, `audit-${formatAuditDirName()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Сохраняет JSON, детальный и краткий Markdown в `output/audit-{timestamp}/`. */
export function writeAuditReports(
  result: AuditResult,
  outputDir?: string,
  extras: { ignoredCount?: number; ignoredUrls?: string[] } = {},
): AuditOutputPaths {
  const dir = outputDir ?? createAuditOutputDir();
  fs.mkdirSync(dir, { recursive: true });

  const jsonPath = path.join(dir, "audit.json");
  const markdownPath = path.join(dir, "audit.md");
  const summaryPath = path.join(dir, "summary.md");
  const reportPath = path.join(dir, "audit-report.md");
  const htmlPath = path.join(dir, "audit-report.html");
  const humanSummaryPath = path.join(dir, "human-summary.md");

  fs.writeFileSync(jsonPath, buildDetailJson(result), "utf8");
  fs.writeFileSync(markdownPath, buildDetailMarkdown(result), "utf8");
  fs.writeFileSync(summaryPath, buildSummaryMarkdown(result), "utf8");
  fs.writeFileSync(
    reportPath,
    buildContractAuditMarkdown(result, {
      ignoredCount: extras.ignoredCount ?? 0,
    }),
    "utf8",
  );
  fs.writeFileSync(
    htmlPath,
    buildContractAuditHtml(result, {
      ignoredCount: extras.ignoredCount ?? 0,
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "evidence-examples.json"),
    JSON.stringify(buildExampleEvidenceResults(result), null, 2),
    "utf8",
  );

  return {
    dir,
    runId: auditRunIdFromDir(dir),
    jsonPath,
    markdownPath,
    summaryPath,
    reportPath,
    htmlPath,
    humanSummaryPath,
  };
}
