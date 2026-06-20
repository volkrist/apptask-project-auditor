import path from "node:path";

/** Публичный URL web-отчёта для Discord (только если задан PUBLIC_REPORT_BASE_URL). */
export function buildReportWebUrl(runId: string): string | null {
  const base =
    process.env.PUBLIC_REPORT_BASE_URL?.trim() ||
    process.env.AUDIT_WEB_BASE_URL?.trim();
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/reports/${runId}`;
}

export function auditRunIdFromDir(dir: string): string {
  return path.basename(dir);
}
