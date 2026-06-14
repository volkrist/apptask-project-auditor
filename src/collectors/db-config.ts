/** SQL Server connection settings — secrets only from env, never committed. */

export type DbConfig = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  /** Parsed from APPTASK_DB_BOARD_IDS (comma-separated). */
  boardIds: number[];
  /** Base URL prefix, e.g. https://apptask.ru/c/7 */
  appTaskBaseUrl: string;
};

const FORBIDDEN_SQL =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|MERGE|TRUNCATE|EXEC(?:UTE)?|GRANT|REVOKE|DENY)\b/i;

/** Throws if query is not a read-only SELECT. */
export function assertSelectOnly(sql: string): void {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
  if (!/^SELECT\b/i.test(stripped)) {
    throw new Error("DB client: only SELECT queries are allowed");
  }
  if (FORBIDDEN_SQL.test(stripped)) {
    throw new Error("DB client: forbidden SQL keyword in query");
  }
}

export function parseBoardIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  const ids = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(ids)];
}

function parseAppTaskBaseUrl(): string {
  const explicit = process.env.APPTASK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const fromBoard = process.env.APPTASK_BOARD_URL?.match(/^(https?:\/\/[^/]+\/c\/\d+)/i);
  if (fromBoard?.[1]) return fromBoard[1];
  const companyId = process.env.APPTASK_COMPANY_ID?.trim() || "7";
  return `https://apptask.ru/c/${companyId}`;
}

export function loadDbConfig(
  overrides: Partial<Pick<DbConfig, "boardIds">> = {},
): DbConfig {
  const host = process.env.APPTASK_DB_HOST?.trim();
  const user = process.env.APPTASK_DB_USER?.trim();
  const password = process.env.APPTASK_DB_PASSWORD ?? "";
  const database = process.env.APPTASK_DB_NAME?.trim();

  if (!host || !user || !database) {
    throw new Error(
      "DB config incomplete: set APPTASK_DB_HOST, APPTASK_DB_USER, APPTASK_DB_NAME (and APPTASK_DB_PASSWORD) in .env",
    );
  }

  const port = Number(process.env.APPTASK_DB_PORT ?? "1433");
  const boardIds =
    overrides.boardIds ??
    parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 1433,
    database,
    user,
    password,
    encrypt: process.env.APPTASK_DB_ENCRYPT?.trim().toLowerCase() === "true",
    trustServerCertificate:
      process.env.APPTASK_DB_TRUST_SERVER_CERTIFICATE?.trim().toLowerCase() !==
      "false",
    boardIds,
    appTaskBaseUrl: parseAppTaskBaseUrl(),
  };
}

export function buildTaskUrl(
  baseUrl: string,
  boardId: number,
  taskId: number | string,
): string {
  return `${baseUrl.replace(/\/$/, "")}/board/${boardId}/${taskId}`;
}
