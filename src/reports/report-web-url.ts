import path from "node:path";

/** Базовый URL для ссылки на web-отчёт в Discord (AUDIT_WEB_BASE_URL или HOST:PORT). */
export function buildReportWebUrl(runId: string): string | null {
  const explicit = process.env.AUDIT_WEB_BASE_URL?.trim();
  if (explicit) {
    return `${explicit.replace(/\/$/, "")}/reports/${runId}`;
  }
  const port = process.env.PORT?.trim() || "3000";
  const hostRaw = process.env.HOST?.trim() || "127.0.0.1";
  const host = hostRaw === "0.0.0.0" ? "localhost" : hostRaw === "127.0.0.1" ? "localhost" : hostRaw;
  return `http://${host}:${port}/reports/${runId}`;
}

export function auditRunIdFromDir(dir: string): string {
  return path.basename(dir);
}
