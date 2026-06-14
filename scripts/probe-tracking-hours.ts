/**
 * Discovery probe: where AppTask stores tracked hours/minutes per task (read-only SELECT).
 *
 * npm run probe:tracking:hours
 * npm run probe:tracking:hours -- --board-ids 783,445,54
 */
import "dotenv/config";
import { loadDbConfig, parseBoardIds } from "../src/collectors/db-config.js";
import {
  boardIdsInClause,
  closeDb,
  querySelect,
} from "../src/collectors/db-client.js";
import type { DbConfig } from "../src/collectors/db-config.js";
import {
  fetchActiveTasks,
  fetchAssignees,
} from "../src/collectors/db-queries.js";

const TRACKING_TABLES = [
  "UserTrackings",
  "UserTrackingSummaries",
  "UserTrackingAreas",
  "UserTrackingAreaReports",
  "UserTrackingManualChanges",
  "UserTrackingProcess",
  "UserTrackingIOs",
  "UserTrackingScreens",
  "TrackingUpdateMarks",
] as const;

const DEFAULT_BOARD_IDS = [783, 445, 54];

type ColumnRow = {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
};

type CountRow = { cnt: number };

type TableProbe = {
  table: string;
  skipReason?: string;
  columns: ColumnRow[];
  taskIdCols: string[];
  userIdCols: string[];
  boardIdCols: string[];
  dateCols: string[];
  durationCols: string[];
  removedCols: string[];
  rowCount: number | null;
  sampleRows: Record<string, unknown>[];
  linkedTaskRows: number | null;
  linkedUserRows: number | null;
  boardCounts: Array<{ boardId: number; count: number }>;
  distinctTaskIds: number | null;
  distinctUserIds: number | null;
  dateMin: string | null;
  dateMax: string | null;
  durationSum: number | null;
  durationColumn: string | null;
  linkTaskColumn: string | null;
  linkUserColumn: string | null;
  linkBoardColumn: string | null;
};

const TASK_ID_RE =
  /^(board_)?task(_id)?$|^taskid$|^boardtaskid$/i;
const USER_ID_RE = /^user(_id)?$|^userid$/i;
const BOARD_ID_RE = /^board(_id)?$|^boardid$/i;
const DATE_RE =
  /date|time|day|period|created|updated|start|end|from|to|mark/i;
const DURATION_RE =
  /minute|hour|duration|spent|tracked|elapsed|length|amount|total/i;
const REMOVED_RE = /removed|deleted|archived|disabled|active/i;
const NUMERIC_TYPES =
  /^(bigint|int|smallint|tinyint|decimal|numeric|float|real|money|smallmoney)$/i;

function parseArgs(argv: string[]): number[] {
  const ids: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--board-ids" && argv[i + 1]) {
      ids.push(...parseBoardIds(argv[++i]));
    } else if (a.startsWith("--board-ids=")) {
      ids.push(...parseBoardIds(a.slice("--board-ids=".length)));
    }
  }
  return ids;
}

function isSafeIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function classifyColumns(columns: ColumnRow[]): Pick<
  TableProbe,
  | "taskIdCols"
  | "userIdCols"
  | "boardIdCols"
  | "dateCols"
  | "durationCols"
  | "removedCols"
> {
  const taskIdCols: string[] = [];
  const userIdCols: string[] = [];
  const boardIdCols: string[] = [];
  const dateCols: string[] = [];
  const durationCols: string[] = [];
  const removedCols: string[] = [];

  for (const c of columns) {
    const n = c.COLUMN_NAME;
    if (TASK_ID_RE.test(n)) taskIdCols.push(n);
    if (USER_ID_RE.test(n)) userIdCols.push(n);
    if (BOARD_ID_RE.test(n)) boardIdCols.push(n);
    if (DATE_RE.test(n) || /datetime|date/i.test(c.DATA_TYPE)) {
      if (!/^end_time$/i.test(n) || !NUMERIC_TYPES.test(c.DATA_TYPE)) {
        dateCols.push(n);
      }
    }
    if (
      DURATION_RE.test(n) ||
      (/^end_time$/i.test(n) && NUMERIC_TYPES.test(c.DATA_TYPE))
    ) {
      if (NUMERIC_TYPES.test(c.DATA_TYPE) || /char|text/i.test(c.DATA_TYPE)) {
        durationCols.push(n);
      }
    }
    if (REMOVED_RE.test(n)) removedCols.push(n);
  }

  return {
    taskIdCols,
    userIdCols,
    boardIdCols,
    dateCols,
    durationCols,
    removedCols,
  };
}

function formatCell(value: unknown, max = 60): string {
  if (value == null) return "NULL";
  if (value instanceof Date) return value.toISOString();
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function formatRow(row: Record<string, unknown>): string {
  return Object.entries(row)
    .map(([k, v]) => `${k}=${formatCell(v, 40)}`)
    .join("; ");
}

async function safeQuery<T extends Record<string, unknown>>(
  config: DbConfig,
  sqlText: string,
  params: Record<string, string | number | boolean | null> = {},
): Promise<T[] | null> {
  try {
    return await querySelect<T>(config, sqlText, params);
  } catch {
    return null;
  }
}

async function fetchColumns(
  config: DbConfig,
  table: string,
): Promise<ColumnRow[] | null> {
  return safeQuery<ColumnRow>(
    config,
    `
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tableName
ORDER BY ORDINAL_POSITION
`,
    { tableName: table },
  );
}

async function countTable(
  config: DbConfig,
  table: string,
): Promise<number | null> {
  const rows = await safeQuery<CountRow>(
    config,
    `SELECT COUNT(*) AS cnt FROM dbo.[${table}]`,
  );
  return rows?.[0]?.cnt ?? null;
}

async function fetchSample(
  config: DbConfig,
  table: string,
  limit = 5,
): Promise<Record<string, unknown>[]> {
  const rows = await safeQuery<Record<string, unknown>>(
    config,
    `SELECT TOP (${limit}) * FROM dbo.[${table}]`,
  );
  return rows ?? [];
}

async function countLinkedTasks(
  config: DbConfig,
  table: string,
  taskCol: string,
  boardCol: string | null,
): Promise<number | null> {
  if (!isSafeIdent(taskCol)) return null;
  const joinBoard =
    boardCol && isSafeIdent(boardCol)
      ? ` AND t.[${boardCol}] = bt.board_id`
      : "";
  const rows = await safeQuery<CountRow>(
    config,
    `
SELECT COUNT(*) AS cnt
FROM dbo.[${table}] t
INNER JOIN dbo.BoardTasks bt ON t.[${taskCol}] = bt.id${joinBoard}
WHERE t.[${taskCol}] IS NOT NULL
`,
  );
  return rows?.[0]?.cnt ?? null;
}

async function countLinkedUsers(
  config: DbConfig,
  table: string,
  userCol: string,
): Promise<number | null> {
  if (!isSafeIdent(userCol)) return null;
  const rows = await safeQuery<CountRow>(
    config,
    `
SELECT COUNT(*) AS cnt
FROM dbo.[${table}] t
INNER JOIN dbo.Users u ON t.[${userCol}] = u.id
`,
  );
  return rows?.[0]?.cnt ?? null;
}

async function countDistinct(
  config: DbConfig,
  table: string,
  col: string,
): Promise<number | null> {
  if (!isSafeIdent(col)) return null;
  const rows = await safeQuery<CountRow>(
    config,
    `SELECT COUNT(DISTINCT t.[${col}]) AS cnt FROM dbo.[${table}] t WHERE t.[${col}] IS NOT NULL`,
  );
  return rows?.[0]?.cnt ?? null;
}

async function countByBoardViaTasks(
  config: DbConfig,
  table: string,
  taskCol: string,
  boardCol: string | null,
  boardIds: number[],
): Promise<Array<{ boardId: number; count: number }>> {
  if (!isSafeIdent(taskCol) || boardIds.length === 0) return [];
  const { clause, params } = boardIdsInClause(boardIds, "probeBoard");
  const joinBoard =
    boardCol && isSafeIdent(boardCol)
      ? ` AND t.[${boardCol}] = bt.board_id`
      : "";
  const rows = await safeQuery<{ board_id: number; cnt: number }>(
    config,
    `
SELECT bt.board_id, COUNT(*) AS cnt
FROM dbo.[${table}] t
INNER JOIN dbo.BoardTasks bt ON t.[${taskCol}] = bt.id${joinBoard}
WHERE bt.board_id IN (${clause}) AND t.[${taskCol}] IS NOT NULL
GROUP BY bt.board_id
ORDER BY bt.board_id
`,
    params,
  );
  if (!rows) return [];
  const byBoard = new Map(rows.map((r) => [r.board_id, r.cnt]));
  return boardIds.map((boardId) => ({
    boardId,
    count: byBoard.get(boardId) ?? 0,
  }));
}

async function countByBoardDirect(
  config: DbConfig,
  table: string,
  boardCol: string,
  boardIds: number[],
): Promise<Array<{ boardId: number; count: number }>> {
  if (!isSafeIdent(boardCol) || boardIds.length === 0) return [];
  const { clause, params } = boardIdsInClause(boardIds, "probeBoard");
  const rows = await safeQuery<{ board_id: number; cnt: number }>(
    config,
    `
SELECT t.[${boardCol}] AS board_id, COUNT(*) AS cnt
FROM dbo.[${table}] t
WHERE t.[${boardCol}] IN (${clause})
GROUP BY t.[${boardCol}]
ORDER BY t.[${boardCol}]
`,
    params,
  );
  if (!rows) return [];
  const byBoard = new Map(rows.map((r) => [r.board_id, r.cnt]));
  return boardIds.map((boardId) => ({
    boardId,
    count: byBoard.get(boardId) ?? 0,
  }));
}

async function minMaxDate(
  config: DbConfig,
  table: string,
  dateCol: string,
): Promise<{ min: string | null; max: string | null }> {
  if (!isSafeIdent(dateCol)) return { min: null, max: null };
  const rows = await safeQuery<{ minDate: unknown; maxDate: unknown }>(
    config,
    `
SELECT MIN(t.[${dateCol}]) AS minDate, MAX(t.[${dateCol}]) AS maxDate
FROM dbo.[${table}] t
WHERE t.[${dateCol}] IS NOT NULL
`,
  );
  const row = rows?.[0];
  return {
    min: row?.minDate != null ? formatCell(row.minDate, 40) : null,
    max: row?.maxDate != null ? formatCell(row.maxDate, 40) : null,
  };
}

async function sumDuration(
  config: DbConfig,
  table: string,
  col: string,
): Promise<number | null> {
  if (!isSafeIdent(col)) return null;
  const rows = await safeQuery<{ total: number | null }>(
    config,
    `
SELECT SUM(CAST(t.[${col}] AS float)) AS total
FROM dbo.[${table}] t
WHERE t.[${col}] IS NOT NULL
`,
  );
  const v = rows?.[0]?.total;
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

function pickBestColumn(candidates: string[], preferred: RegExp[]): string | null {
  for (const re of preferred) {
    const hit = candidates.find((c) => re.test(c));
    if (hit) return hit;
  }
  return candidates[0] ?? null;
}

async function probeTable(
  config: DbConfig,
  table: string,
  boardIds: number[],
): Promise<TableProbe> {
  const base: TableProbe = {
    table,
    columns: [],
    taskIdCols: [],
    userIdCols: [],
    boardIdCols: [],
    dateCols: [],
    durationCols: [],
    removedCols: [],
    rowCount: null,
    sampleRows: [],
    linkedTaskRows: null,
    linkedUserRows: null,
    boardCounts: [],
    distinctTaskIds: null,
    distinctUserIds: null,
    dateMin: null,
    dateMax: null,
    durationSum: null,
    durationColumn: null,
    linkTaskColumn: null,
    linkUserColumn: null,
    linkBoardColumn: null,
  };

  const columns = await fetchColumns(config, table);
  if (!columns || columns.length === 0) {
    base.skipReason = "table not found or no column metadata";
    return base;
  }

  base.columns = columns;
  const classified = classifyColumns(columns);
  Object.assign(base, classified);

  base.rowCount = await countTable(config, table);
  base.sampleRows = await fetchSample(config, table, 5);

  base.linkTaskColumn = pickBestColumn(base.taskIdCols, [
    /^board_task_id$/i,
    /^task_id$/i,
    /^taskid$/i,
  ]);
  base.linkUserColumn = pickBestColumn(base.userIdCols, [
    /^user_id$/i,
    /^userid$/i,
  ]);
  base.linkBoardColumn = pickBestColumn(base.boardIdCols, [
    /^board_id$/i,
    /^boardid$/i,
  ]);
  base.durationColumn = pickBestColumn(base.durationCols, [
    /minute/i,
    /hour/i,
    /duration/i,
    /spent/i,
    /tracked/i,
    /time/i,
  ]);

  if (base.linkTaskColumn) {
    base.linkedTaskRows = await countLinkedTasks(
      config,
      table,
      base.linkTaskColumn,
      base.linkBoardColumn,
    );
    base.distinctTaskIds = await countDistinct(
      config,
      table,
      base.linkTaskColumn,
    );
    base.boardCounts = await countByBoardViaTasks(
      config,
      table,
      base.linkTaskColumn,
      base.linkBoardColumn,
      boardIds,
    );
  } else if (base.linkBoardColumn) {
    base.boardCounts = await countByBoardDirect(
      config,
      table,
      base.linkBoardColumn,
      boardIds,
    );
  }

  if (base.linkUserColumn) {
    base.linkedUserRows = await countLinkedUsers(
      config,
      table,
      base.linkUserColumn,
    );
    base.distinctUserIds = await countDistinct(
      config,
      table,
      base.linkUserColumn,
    );
  }

  const dateCol =
    pickBestColumn(base.dateCols, [
      /^date$/i,
      /^tracking_date$/i,
      /^create_time$/i,
      /^start_time$/i,
      /^day$/i,
    ]) ?? base.dateCols[0];
  if (dateCol) {
    const mm = await minMaxDate(config, table, dateCol);
    base.dateMin = mm.min;
    base.dateMax = mm.max;
  }

  if (base.durationColumn) {
    base.durationSum = await sumDuration(config, table, base.durationColumn);
  }

  return base;
}

function printSection(title: string): void {
  console.log(`\n## ${title}\n`);
}

function printTableSchema(probes: TableProbe[]): void {
  printSection("Tracking tables schema");
  for (const p of probes) {
    console.log(`### dbo.${p.table}`);
    if (p.skipReason) {
      console.log(`SKIP: ${p.skipReason}\n`);
      continue;
    }
    console.log(`rows (COUNT): ${p.rowCount ?? "?"}`);
    for (const c of p.columns) {
      console.log(
        `  - ${c.COLUMN_NAME}: ${c.DATA_TYPE} (nullable=${c.IS_NULLABLE})`,
      );
    }
    console.log("");
  }
}

function printCandidateColumns(probes: TableProbe[]): void {
  printSection("Candidate time columns");
  for (const p of probes) {
    if (p.skipReason) {
      console.log(`${p.table}: SKIP (${p.skipReason})`);
      continue;
    }
    if (p.durationCols.length === 0) {
      console.log(`${p.table}: (no duration-like columns detected)`);
      continue;
    }
    console.log(
      `${p.table}: ${p.durationCols.join(", ")}` +
        (p.durationColumn
          ? ` | SUM(${p.durationColumn})=${p.durationSum ?? "n/a"}`
          : ""),
    );
  }
}

function printCandidateLinks(probes: TableProbe[]): void {
  printSection("Candidate task/user links");
  for (const p of probes) {
    if (p.skipReason) {
      console.log(`${p.table}: SKIP (${p.skipReason})`);
      continue;
    }
    const parts: string[] = [];
    if (p.taskIdCols.length) parts.push(`task cols: ${p.taskIdCols.join(", ")}`);
    if (p.userIdCols.length) parts.push(`user cols: ${p.userIdCols.join(", ")}`);
    if (p.boardIdCols.length) parts.push(`board cols: ${p.boardIdCols.join(", ")}`);
    if (p.dateCols.length) parts.push(`date cols: ${p.dateCols.join(", ")}`);
    if (p.removedCols.length) parts.push(`removed cols: ${p.removedCols.join(", ")}`);
    console.log(`${p.table}: ${parts.join(" | ") || "(none)"}`);
    if (p.linkTaskColumn) {
      console.log(
        `  join BoardTasks.id via ${p.linkTaskColumn}: ${p.linkedTaskRows ?? "?"} rows, distinct tasks=${p.distinctTaskIds ?? "?"}`,
      );
    } else {
      console.log("  join BoardTasks: SKIP (no task_id-like column)");
    }
    if (p.linkUserColumn) {
      console.log(
        `  join Users.id via ${p.linkUserColumn}: ${p.linkedUserRows ?? "?"} rows, distinct users=${p.distinctUserIds ?? "?"}`,
      );
    }
    if (p.sampleRows.length > 0) {
      console.log(`  sample TOP ${p.sampleRows.length}:`);
      for (const row of p.sampleRows) {
        console.log(`    ${formatRow(row)}`);
      }
    }
  }
}

function printBoardCoverage(probes: TableProbe[], boardIds: number[]): void {
  printSection("Board coverage");
  console.log(`Target board IDs: ${boardIds.join(", ")}`);
  for (const p of probes) {
    if (p.skipReason) continue;
    console.log(`\n${p.table}:`);
    console.log(`  total rows: ${p.rowCount ?? "?"}`);
    if (p.boardCounts.length > 0) {
      for (const b of p.boardCounts) {
        console.log(`  board ${b.boardId}: ${b.count} tracking rows`);
      }
    } else if (p.linkTaskColumn) {
      console.log("  board breakdown: SKIP (join returned no rows or failed)");
    } else {
      console.log("  board breakdown: SKIP (no task/board link column)");
    }
    if (p.dateMin || p.dateMax) {
      console.log(`  date range: ${p.dateMin ?? "?"} .. ${p.dateMax ?? "?"}`);
    }
  }
}

async function printSampleTaskTracking(
  config: DbConfig,
  probes: TableProbe[],
  boardIds: number[],
): Promise<void> {
  printSection("Sample task tracking");
  const board783 = boardIds.includes(783) ? 783 : boardIds[0];
  if (!board783) {
    console.log("SKIP: no board ids configured");
    return;
  }

  const primary = pickPrimaryTable(probes);
  if (!primary?.linkTaskColumn) {
    console.log("SKIP: no table with task_id link to BoardTasks found");
    return;
  }

  const tasks = (await fetchActiveTasks(config, [board783])).slice(0, 5);
  const assignees = await fetchAssignees(
    config,
    tasks.map((t) => t.id),
  );
  const assigneesByTask = new Map<number, string[]>();
  for (const a of assignees) {
    const list = assigneesByTask.get(a.task_id) ?? [];
    list.push(a.user_name ?? String(a.user_id));
    assigneesByTask.set(a.task_id, list);
  }

  const { table, linkTaskColumn, durationColumn, linkUserColumn } = primary;
  console.log(
    `Using dbo.${table} (task link: ${linkTaskColumn}` +
      (durationColumn ? `, duration: ${durationColumn}` : "") +
      ")\n",
  );

  for (const task of tasks) {
    const boardCol = primary.linkBoardColumn ?? "board_id";
    const orderCol =
      pickBestColumn(primary.dateCols, [/^date$/i, /^latest_update$/i]) ??
      primary.columns[0]?.COLUMN_NAME ??
      "id";
    const trackingRows = await safeQuery<Record<string, unknown>>(
      config,
      `
SELECT TOP 10 *
FROM dbo.[${table}] t
WHERE t.[${linkTaskColumn!}] = @taskId
  AND t.[${boardCol}] = @boardId
ORDER BY t.[${orderCol}] DESC
`,
      { taskId: task.id, boardId: task.board_id },
    );

    let totalMinutes: number | null = null;
    if (durationColumn && trackingRows && trackingRows.length > 0) {
      totalMinutes = trackingRows.reduce((acc, row) => {
        const v = Number(row[durationColumn]);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);
    }

    console.log(`task #${task.id} | board ${task.board_id}`);
    console.log(`  title: ${formatCell(task.task_name, 80)}`);
    console.log(`  status: ${task.status_name ?? "—"}`);
    console.log(
      `  assignees: ${(assigneesByTask.get(task.id) ?? []).join(", ") || "—"}`,
    );
    console.log(`  tracking rows: ${trackingRows?.length ?? 0}`);
    if (totalMinutes != null) {
      console.log(`  sample total ${durationColumn}: ${totalMinutes}`);
    }
    if (trackingRows && trackingRows.length > 0) {
      for (const row of trackingRows.slice(0, 3)) {
        const preview = Object.entries(row)
          .filter(([k]) =>
            [linkTaskColumn, durationColumn, linkUserColumn, ...primary.dateCols.slice(0, 2)]
              .filter(Boolean)
              .some((c) => c?.toLowerCase() === k.toLowerCase()),
          )
          .map(([k, v]) => `${k}=${formatCell(v, 30)}`)
          .join("; ");
        console.log(`    ${preview || formatRow(row)}`);
      }
    } else {
      console.log("    (no rows for this task in primary table)");
    }
    console.log("");
  }
}

async function printManualChanges(
  config: DbConfig,
  probes: TableProbe[],
): Promise<void> {
  printSection("Manual changes");
  const manual =
    probes.find((p) => p.table === "UserTrackingManualChanges") ??
    probes.find((p) => p.table.includes("Manual"));

  if (!manual || manual.skipReason) {
    console.log("SKIP: UserTrackingManualChanges not available");
    return;
  }

  console.log(`rows: ${manual.rowCount ?? "?"}`);
  console.log(
    `task cols: ${manual.taskIdCols.join(", ") || "—"} | user cols: ${manual.userIdCols.join(", ") || "—"} | date cols: ${manual.dateCols.join(", ") || "—"}`,
  );
  if (manual.durationCols.length) {
    console.log(`duration-like cols: ${manual.durationCols.join(", ")}`);
  }
  if (manual.linkedTaskRows != null) {
    console.log(`linked to BoardTasks: ${manual.linkedTaskRows} rows`);
  }

  console.log("\nSample rows:");
  if (manual.sampleRows.length === 0) {
    console.log("  (empty table)");
  } else {
    for (const row of manual.sampleRows) {
      console.log(`  ${formatRow(row)}`);
    }
  }

  const note =
    manual.rowCount && manual.rowCount > 0
      ? "Manual changes exist — likely adjustments on top of auto tracking; include separately in fact-hours rules."
      : "No manual change rows — auto tracking tables may be the only source.";
  console.log(`\nNote: ${note}`);
}

function scoreTable(p: TableProbe): number {
  if (p.skipReason) return -1;
  let score = 0;
  if (p.linkedTaskRows) score += Math.min(p.linkedTaskRows, 1_000_000);
  if (p.durationColumn) score += 50_000;
  if (p.rowCount) score += Math.min(p.rowCount, 100_000) / 10;
  if (p.distinctTaskIds) score += Math.min(p.distinctTaskIds, 10_000);
  return score;
}

function pickPrimaryTable(probes: TableProbe[]): TableProbe | null {
  return [...probes].sort((a, b) => scoreTable(b) - scoreTable(a))[0] ?? null;
}

function buildConclusion(probes: TableProbe[]): void {
  printSection("Conclusion");
  const primary = pickPrimaryTable(probes);
  const manual = probes.find((p) => p.table === "UserTrackingManualChanges");

  if (!primary || primary.skipReason || scoreTable(primary) <= 0) {
    console.log("1. Primary fact-time source: UNCLEAR — no table with task link + duration detected.");
    console.log("2. task_id column: unknown");
    console.log("3. user_id column: unknown");
    console.log("4. date column: unknown");
    console.log("5. duration column: unknown");
    console.log("6. tracking-hours rules: NOT YET — need confirmed column mapping.");
    console.log("7. Risks: schema discovery incomplete or tracking stored outside listed tables.");
    return;
  }

  const dateCol =
    pickBestColumn(primary.dateCols, [
      /^date$/i,
      /^tracking_date$/i,
      /^create_time$/i,
      /^start_time$/i,
    ]) ?? primary.dateCols[0] ?? "unknown";

  console.log(
    `1. Primary fact-time source (likely): dbo.${primary.table} (${primary.rowCount ?? "?"} rows, ${primary.linkedTaskRows ?? 0} linked to BoardTasks)`,
  );
  console.log(
    `2. task_id column (likely): ${primary.linkTaskColumn ?? "unknown"}`,
  );
  console.log(
    `3. user_id column (likely): ${primary.linkUserColumn ?? "unknown or not on primary table"}`,
  );
  console.log(`4. date column (likely): ${dateCol}`);
  console.log(
    `5. duration column (likely): ${primary.durationColumn ?? "unknown"}${primary.durationSum != null ? ` (SUM≈${Math.round(primary.durationSum)})` : ""}`,
  );

  const canRules =
    primary.linkTaskColumn &&
    (primary.durationColumn || primary.rowCount);
  console.log(
    `6. tracking-hours rules: ${canRules ? "POSSIBLE after validating units (minutes vs hours) and removed/deleted flags" : "NOT YET"}`,
  );

  const risks: string[] = [];
  if (!primary.durationColumn) {
    risks.push("no obvious duration column on primary table");
  }
  if (primary.durationColumn && !/minute|hour/i.test(primary.durationColumn)) {
    risks.push("duration column name ambiguous — confirm units");
  }
  if (manual && !manual.skipReason && (manual.rowCount ?? 0) > 0) {
    risks.push("UserTrackingManualChanges may adjust totals — decide merge policy");
  }
  const summaryOnly = probes.find(
    (p) => p.table === "UserTrackingSummaries" && (p.rowCount ?? 0) > 0 && !p.linkTaskColumn,
  );
  if (summaryOnly) {
    risks.push("UserTrackingSummaries may hold aggregates without per-task granularity");
  }
  if (primary.removedCols.length === 0) {
    risks.push("no removed/deleted flag detected — may need filter rules");
  }
  risks.push("total_time likely in milliseconds (sample values ~1e6–2e7 per day/user)");
  if (primary.table === "UserTrackingSummaries") {
    risks.push("filter removed=0; task_id IS NOT NULL for per-task rules");
    risks.push("append_total_time may hold manual adjustments when UserTrackingManualChanges unavailable");
  }

  console.log(`7. Risks / open questions: ${risks.join("; ")}`);
}

async function main(): Promise<void> {
  const fromArgv = parseArgs(process.argv.slice(2));
  const boardIds =
    fromArgv.length > 0
      ? fromArgv
      : parseBoardIds(process.env.APPTASK_DB_BOARD_IDS).length > 0
        ? parseBoardIds(process.env.APPTASK_DB_BOARD_IDS)
        : DEFAULT_BOARD_IDS;

  const config = loadDbConfig({ boardIds });

  console.log("=== Tracking hours DB probe (read-only SELECT) ===");
  console.log(`Database: ${config.database} @ ${config.host}:${config.port}`);
  console.log(`Board IDs: ${boardIds.join(", ")}`);

  try {
    const probes: TableProbe[] = [];
    for (const table of TRACKING_TABLES) {
      probes.push(await probeTable(config, table, boardIds));
    }

    printTableSchema(probes);
    printCandidateColumns(probes);
    printCandidateLinks(probes);
    printBoardCoverage(probes, boardIds);
    await printSampleTaskTracking(config, probes, boardIds);
    await printManualChanges(config, probes);
    buildConclusion(probes);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
