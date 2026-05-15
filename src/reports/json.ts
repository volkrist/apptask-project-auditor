import type { AuditResult } from "../rules/rule-types.js";

export function buildDetailJson(result: AuditResult): string {
  return JSON.stringify(result, null, 2);
}
