import sql from "mssql";
import { assertSelectOnly, type DbConfig } from "./db-config.js";

export type DbQueryParams = Record<string, string | number | boolean | null>;

let pool: sql.ConnectionPool | null = null;

export async function connectDb(config: DbConfig): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  pool = await new sql.ConnectionPool({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30_000 },
  }).connect();

  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

/**
 * Execute a parameterized SELECT. Rejects any non-SELECT SQL.
 */
export async function querySelect<T extends Record<string, unknown>>(
  config: DbConfig,
  sqlText: string,
  params: DbQueryParams = {},
): Promise<T[]> {
  assertSelectOnly(sqlText);
  const connection = await connectDb(config);
  const request = connection.request();

  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      request.input(key, sql.NVarChar, null);
    } else if (typeof value === "number") {
      request.input(key, sql.Int, value);
    } else if (typeof value === "boolean") {
      request.input(key, sql.Bit, value);
    } else {
      request.input(key, sql.NVarChar, String(value));
    }
  }

  const result = await request.query<T>(sqlText);
  return result.recordset ?? [];
}

/** Build `IN (@p0, @p1, …)` clause for board ids. */
export function boardIdsInClause(
  boardIds: number[],
  paramPrefix = "boardId",
): { clause: string; params: DbQueryParams } {
  if (boardIds.length === 0) {
    throw new Error("boardIds must not be empty");
  }
  const params: DbQueryParams = {};
  const parts = boardIds.map((id, i) => {
    const key = `${paramPrefix}${i}`;
    params[key] = id;
    return `@${key}`;
  });
  return { clause: parts.join(", "), params };
}
