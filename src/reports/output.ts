import fs from "node:fs";
import path from "node:path";
import type { AuditResult } from "../rules/rule-types.js";
import { buildDetailJson } from "./json.js";
import { buildDetailMarkdown } from "./markdown.js";
import { buildSummaryMarkdown } from "./summary-markdown.js";
import { buildHumanAuditMarkdown } from "./human-audit-markdown.js";

export type AuditOutputPaths = {
  dir: string;
  jsonPath: string;
  markdownPath: string;
  summaryPath: string;
  reportPath: string;
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

  fs.writeFileSync(jsonPath, buildDetailJson(result), "utf8");
  fs.writeFileSync(markdownPath, buildDetailMarkdown(result), "utf8");
  fs.writeFileSync(summaryPath, buildSummaryMarkdown(result), "utf8");
  fs.writeFileSync(
    reportPath,
    buildHumanAuditMarkdown(result, {
      ignoredCount: extras.ignoredCount ?? 0,
      ignoredUrls: extras.ignoredUrls ?? [],
    }),
    "utf8",
  );

  return { dir, jsonPath, markdownPath, summaryPath, reportPath };
}
