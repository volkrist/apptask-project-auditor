import type { AuditResult } from "../rules/rule-types.js";

/** Aggregate rule results into topIssues. Implement with real rules. */
export function buildTopIssues(_result: AuditResult): AuditResult["topIssues"] {
  return [];
}
