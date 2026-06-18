import type { AuditResult } from "../rules/rule-types.js";
import {
  buildRegistryTableRows,
  formatCheckRegistryMarkdown,
  summarizeRegistryOutcomes,
  type RegistryTableRow,
} from "./check-registry-stats.js";

export type CheckExecutionStatus = "CHECKED" | "NOT_APPLICABLE" | "SKIP";

export type CheckRegistryRow = RegistryTableRow & {
  executionStatus: CheckExecutionStatus;
  failCount: number;
  warnCount: number;
  resultText: string;
};

export function buildCheckRegistryRows(result: AuditResult): CheckRegistryRow[] {
  return buildRegistryTableRows(result).map((row) => {
    const failMatch = row.violations.match(/(\d+) FAIL/);
    const warnMatch = row.violations.match(/(\d+) WARN/);
    const failCount = failMatch ? Number(failMatch[1]) : 0;
    const warnCount = warnMatch ? Number(warnMatch[1]) : 0;
    const executionStatus: CheckExecutionStatus =
      row.outcome === "NOT_APPLICABLE"
        ? "NOT_APPLICABLE"
        : row.outcome === "SKIP"
          ? "SKIP"
          : "CHECKED";
    return {
      ...row,
      executionStatus,
      failCount,
      warnCount,
      resultText:
        row.outcome === "OK"
          ? "OK"
          : row.outcome === "SKIP"
            ? "SKIP"
            : row.outcome === "NOT_APPLICABLE"
              ? "не применяется"
              : row.violations,
    };
  });
}

export function summarizeCheckRegistry(rows: CheckRegistryRow[]) {
  return summarizeRegistryOutcomes(rows);
}

export { formatCheckRegistryMarkdown };
