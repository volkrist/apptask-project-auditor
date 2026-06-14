import { google } from "googleapis";
import {
  isGoogleSheetsConfigured,
  type ScrumEstimateConfig,
  type ScrumEstimateRow,
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

function sheetRange(sheetName: string, columns = "A:Z"): string {
  const escaped = sheetName.replace(/'/g, "''");
  return `'${escaped}'!${columns}`;
}

export function parseHours(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function headerIndex(headers: string[], name: string): number {
  const norm = name.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === norm);
}

/** Parse «Смета Декомпозиция» rows into estimate rows. */
export function parseScrumEstimateSheet(
  values: string[][],
  columns: {
    itemColumn?: string;
    taskColumn: string;
    subTaskColumn?: string;
    commentColumn?: string;
    pvColumn: string;
    estimateHoursColumn?: string;
  },
): ScrumEstimateRow[] {
  if (values.length < 2) return [];
  const headers = values[0]!.map((h) => h.trim());
  const itemIdx = columns.itemColumn
    ? headerIndex(headers, columns.itemColumn)
    : headerIndex(headers, "Пункт");
  const taskIdx = headerIndex(headers, columns.taskColumn);
  const subIdx = columns.subTaskColumn
    ? headerIndex(headers, columns.subTaskColumn)
    : headerIndex(headers, "Под Задача");
  const commentIdx = columns.commentColumn
    ? headerIndex(headers, columns.commentColumn)
    : headerIndex(headers, "Коментарий");
  const pvIdx = headerIndex(headers, columns.pvColumn);
  const estimateIdx = columns.estimateHoursColumn
    ? headerIndex(headers, columns.estimateHoursColumn)
    : -1;

  if (taskIdx < 0) return [];

  const rows: ScrumEstimateRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const taskCell = row[taskIdx]?.trim() ?? "";
    if (!taskCell) continue;
    const code =
      itemIdx >= 0
        ? (row[itemIdx]?.trim() ?? "")
        : extractCodeFromTitle(taskCell) ?? "";
    rows.push({
      code,
      title: taskCell,
      plannedHours: pvIdx >= 0 ? parseHours(row[pvIdx]) : null,
      estimateHours: estimateIdx >= 0 ? parseHours(row[estimateIdx]) : null,
      subTask: subIdx >= 0 ? row[subIdx]?.trim() || null : null,
      comment: commentIdx >= 0 ? row[commentIdx]?.trim() || null : null,
      raw: Object.fromEntries(headers.map((h, j) => [h, row[j] ?? ""])),
    });
  }
  return rows;
}

export function extractCodeFromTitle(title: string): string | null {
  const m = title.trim().match(/^(\d+(?:\.\d+)+)\b/);
  return m?.[1] ?? null;
}

export async function loadApprovedEstimateRows(
  config: ScrumEstimateConfig,
): Promise<ScrumEstimateRow[]> {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets credentials not configured");
  }
  if (!config.workSpreadsheetId) {
    throw new Error("GOOGLE_WORK_SPREADSHEET_ID not set");
  }
  const range = sheetRange(config.estimateSheetName);
  const values = await readSheetRows(config.workSpreadsheetId, range);
  return parseScrumEstimateSheet(values, {
    taskColumn: config.taskColumn,
    pvColumn: config.pvColumn,
    subTaskColumn: config.subTaskColumn,
    estimateHoursColumn: config.estimateHoursColumn,
  });
}
