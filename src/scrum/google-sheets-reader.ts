import { google } from "googleapis";
import {
  COMMENT_COLUMN_ALIASES,
  findColumnIndex,
  findHeaderRow,
  HOURS_COLUMN_ALIASES,
  SUBTASK_COLUMN_ALIASES,
  TASK_COLUMN_ALIASES,
} from "./column-aliases.js";
import {
  isGoogleSheetsConfigured,
  type ScrumEstimateConfig,
  type ScrumEstimateRow,
  type ScrumSourceLoadStatus,
  type EstimateLoadStats,
} from "./scrum-estimate-config.js";

function getPrivateKey(): string {
  const raw = process.env.GOOGLE_SHEETS_PRIVATE_KEY ?? "";
  return raw.replace(/\\n/g, "\n");
}

/** Read-only Google Sheets client. Scope: spreadsheets.readonly only. */
export function createReadOnlySheetsClient() {
  if (process.env.GOOGLE_SHEETS_READONLY?.trim().toLowerCase() === "false") {
    throw new Error("GOOGLE_SHEETS_READONLY must be true (read-only MVP)");
  }
  const email = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim();
  if (!email) {
    throw new Error("GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL is not set");
  }
  const auth = new google.auth.JWT({
    email,
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

export async function readSheetRows(
  spreadsheetId: string,
  range: string,
): Promise<string[][]> {
  const sheets = createReadOnlySheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  return (res.data.values as string[][]) ?? [];
}

export async function listSpreadsheetSheetTitles(
  spreadsheetId: string,
): Promise<string[]> {
  const sheets = createReadOnlySheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  return (res.data.sheets ?? [])
    .map((s) => s.properties?.title ?? "")
    .filter(Boolean);
}

function sheetRange(sheetName: string, columns = "A:Z"): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!${columns}`;
}

export function parseHours(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function extractCodeFromTitle(title: string): string | null {
  const m = title.trim().match(/^(\d+(?:\.\d+)+)\b/);
  return m?.[1] ?? null;
}

function combineFullTitle(code: string, taskTitle: string): string {
  const trimmedTask = taskTitle.trim();
  const trimmedCode = code.trim();
  if (!trimmedTask) return trimmedCode;
  if (!trimmedCode) return trimmedTask;
  if (trimmedTask.startsWith(trimmedCode)) return trimmedTask;
  return `${trimmedCode} ${trimmedTask}`.replace(/\s+/g, " ").trim();
}

function buildEstimateRow(params: {
  sourceSheet: string;
  rowIndex: number;
  code: string;
  taskTitle: string;
  subtaskTitle: string | null;
  hours: number | null;
  hoursRisk: number | null;
  comment: string | null;
  raw: Record<string, string>;
}): ScrumEstimateRow {
  const fullTitle = combineFullTitle(params.code, params.taskTitle);
  return {
    sourceSheet: params.sourceSheet,
    rowIndex: params.rowIndex,
    taskTitle: params.taskTitle,
    subtaskTitle: params.subtaskTitle,
    fullTitle: fullTitle || params.taskTitle,
    estimateHours: params.hours,
    code: params.code,
    title: fullTitle || params.taskTitle,
    plannedHours: params.hours,
    estimateHoursRisk: params.hoursRisk,
    subTask: params.subtaskTitle,
    comment: params.comment,
    raw: params.raw,
  };
}

export type ParseScrumSheetResult = {
  rows: ScrumEstimateRow[];
  headerRow: number | null;
  skipReason?: string;
};

/** Parse estimate rows from a sheet with header scan and column aliases. */
export function parseScrumEstimateSheet(
  values: string[][],
  options: {
    sourceSheet: string;
    headerScanRows?: number;
  },
): ParseScrumSheetResult {
  if (values.length === 0) {
    return { rows: [], headerRow: null, skipReason: "лист пуст" };
  }

  const headerInfo = findHeaderRow(values, options.headerScanRows ?? 80);
  if (!headerInfo) {
    return {
      rows: [],
      headerRow: null,
      skipReason: "шапка с колонкой «Задача»/«Пункт» не найдена в первых 80 строках",
    };
  }

  const { rowIndex: headerRowIndex, headers } = headerInfo;
  const taskIdx = findColumnIndex(headers, TASK_COLUMN_ALIASES);
  const itemIdx = findColumnIndex(headers, ["пункт"]);
  if (taskIdx < 0) {
    return {
      rows: [],
      headerRow: headerRowIndex,
      skipReason: "колонка задачи не найдена",
    };
  }

  const subIdx = findColumnIndex(headers, SUBTASK_COLUMN_ALIASES);
  const hoursIdx = findColumnIndex(headers, HOURS_COLUMN_ALIASES);
  const commentIdx = findColumnIndex(headers, COMMENT_COLUMN_ALIASES);
  const riskIdx = findColumnIndex(headers, [
    "часы (с рисками). к смете",
    "часы (с орисками). к смете",
  ]);

  const rows: ScrumEstimateRow[] = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const row = values[i] ?? [];
    let taskCell = row[taskIdx]?.trim() ?? "";
    if (itemIdx >= 0 && itemIdx !== taskIdx) {
      const itemCell = row[itemIdx]?.trim() ?? "";
      if (
        itemCell &&
        (!taskCell || /^[\d.,]+$/.test(taskCell) || taskCell.length <= 2)
      ) {
        taskCell = itemCell;
      }
    }
    if (!taskCell) continue;

    const code =
      itemIdx >= 0 && itemIdx !== taskIdx
        ? (row[itemIdx]?.trim() ?? "")
        : extractCodeFromTitle(taskCell) ?? "";
    const taskTitle = taskCell;
    const subtaskTitle =
      subIdx >= 0 ? row[subIdx]?.trim() || null : null;
    const hours = hoursIdx >= 0 ? parseHours(row[hoursIdx]) : null;
    const hoursRisk = riskIdx >= 0 ? parseHours(row[riskIdx]) : null;

    rows.push(
      buildEstimateRow({
        sourceSheet: options.sourceSheet,
        rowIndex: i + 1,
        code,
        taskTitle,
        subtaskTitle,
        hours,
        hoursRisk,
        comment: commentIdx >= 0 ? row[commentIdx]?.trim() || null : null,
        raw: Object.fromEntries(headers.map((h, j) => [h, row[j] ?? ""])),
      }),
    );
  }

  return { rows, headerRow: headerRowIndex + 1 };
}

function mergeEstimateRows(
  primary: ScrumEstimateRow[],
  extra: ScrumEstimateRow[],
): ScrumEstimateRow[] {
  const seen = new Set(
    primary.map((r) => r.fullTitle.toLowerCase().replace(/ё/g, "е")),
  );
  const merged = [...primary];
  for (const row of extra) {
    const key = row.fullTitle.toLowerCase().replace(/ё/g, "е");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

async function loadSheetEstimateRows(
  spreadsheetId: string,
  sheetName: string,
  config: ScrumEstimateConfig,
): Promise<ParseScrumSheetResult & { rawRows: number }> {
  const values = await readSheetRows(
    spreadsheetId,
    sheetRange(sheetName),
  );
  const parsed = parseScrumEstimateSheet(values, {
    sourceSheet: sheetName,
    headerScanRows: config.headerScanRows,
  });
  return { ...parsed, rawRows: values.length };
}

export type LoadAllEstimateResult = {
  rows: ScrumEstimateRow[];
  sources: ScrumSourceLoadStatus[];
  stats: EstimateLoadStats;
};

export async function loadAllEstimateRows(
  config: ScrumEstimateConfig,
): Promise<LoadAllEstimateResult> {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets credentials not configured");
  }
  if (!config.scrumSpreadsheetId) {
    throw new Error("GOOGLE_SCRUM_SPREADSHEET_ID not set");
  }

  const sources: ScrumSourceLoadStatus[] = [];
  let rows: ScrumEstimateRow[] = [];
  let apiRawRows = 0;
  let parsedRowsBeforeDedup = 0;

  const scrumSheets = await listSpreadsheetSheetTitles(config.scrumSpreadsheetId);
  const sprintSheets = scrumSheets.filter(
    (name) =>
      config.sprintSheetPattern.test(name) &&
      !config.sprintSheetExcludePattern.test(name),
  );

  for (const sheetName of sprintSheets) {
    try {
      const parsed = await loadSheetEstimateRows(
        config.scrumSpreadsheetId,
        sheetName,
        config,
      );
      apiRawRows += parsed.rawRows;
      parsedRowsBeforeDedup += parsed.rows.length;
      const beforeMerge = rows.length;
      rows = mergeEstimateRows(rows, parsed.rows);
      sources.push({
        source: "sprint",
        sheetName,
        status: parsed.rows.length > 0 ? "ok" : "skip",
        rawRows: parsed.rawRows,
        parsedRows: parsed.rows.length,
        mergedAddedRows: rows.length - beforeMerge,
        reason:
          parsed.rows.length > 0
            ? undefined
            : (parsed.skipReason ?? "нет строк задач"),
      });
    } catch (err) {
      sources.push({
        source: "sprint",
        sheetName,
        status: "error",
        rawRows: 0,
        parsedRows: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (scrumSheets.includes(config.decompositionSheetName)) {
    try {
      const parsed = await loadSheetEstimateRows(
        config.scrumSpreadsheetId,
        config.decompositionSheetName,
        config,
      );
      apiRawRows += parsed.rawRows;
      parsedRowsBeforeDedup += parsed.rows.length;
      const added = parsed.rows.filter((r) => {
        const key = r.fullTitle.toLowerCase().replace(/ё/g, "е");
        return !rows.some(
          (x) => x.fullTitle.toLowerCase().replace(/ё/g, "е") === key,
        );
      });
      sources.push({
        source: "decomposition",
        sheetName: config.decompositionSheetName,
        status: parsed.rows.length > 0 ? "ok" : "skip",
        rawRows: parsed.rawRows,
        parsedRows: parsed.rows.length,
        mergedAddedRows: added.length,
        reason:
          parsed.rows.length > 0
            ? added.length < parsed.rows.length
              ? `добавлено ${added.length} из ${parsed.rows.length} (дедуп с sprint)`
              : undefined
            : (parsed.skipReason ?? "нет строк задач"),
      });
      rows = mergeEstimateRows(rows, added);
    } catch (err) {
      sources.push({
        source: "decomposition",
        sheetName: config.decompositionSheetName,
        status: "error",
        rawRows: 0,
        parsedRows: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    sources.push({
      source: "decomposition",
      sheetName: config.decompositionSheetName,
      status: "skip",
      rawRows: 0,
      parsedRows: 0,
      reason: "лист не найден в Scrum-портале",
    });
  }

  if (config.workSpreadsheetId) {
    try {
      const parsed = await loadSheetEstimateRows(
        config.workSpreadsheetId,
        config.workEstimateSheetName,
        config,
      );
      sources.push({
        source: "work_optional",
        sheetName: config.workEstimateSheetName,
        status: parsed.rows.length > 0 ? "ok" : "skip",
        rawRows: parsed.rawRows,
        parsedRows: parsed.rows.length,
        reason:
          parsed.rows.length > 0
            ? "optional — не используется при наличии Scrum-источников"
            : (parsed.skipReason ??
              "нестандартная структура — optional source пропущен"),
      });
    } catch (err) {
      sources.push({
        source: "work_optional",
        sheetName: config.workEstimateSheetName,
        status: "skip",
        rawRows: 0,
        parsedRows: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const stats: EstimateLoadStats = {
    apiRawRows,
    parsedRowsBeforeDedup,
    uniqueRows: rows.length,
    duplicatesRemoved: Math.max(0, parsedRowsBeforeDedup - rows.length),
  };

  return { rows, sources, stats };
}

/** @deprecated use loadAllEstimateRows */
export async function loadApprovedEstimateRows(
  config: ScrumEstimateConfig,
): Promise<ScrumEstimateRow[]> {
  const { rows } = await loadAllEstimateRows(config);
  return rows;
}