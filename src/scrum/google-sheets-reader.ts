import { google } from "googleapis";
import { isGoogleSheetsConfigured } from "./scrum-estimate-config.js";
import type { ScrumEstimateRow } from "./scrum-estimate-config.js";

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

function parseHours(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const n = Number(raw.replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function headerIndex(headers: string[], name: string): number {
  const norm = name.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === norm);
}

/** Parse Scrum portal sheet rows into estimate rows (MVP column names from config). */
export function parseScrumEstimateSheet(
  values: string[][],
  columns: {
    itemColumn?: string;
    taskColumn: string;
    subTaskColumn?: string;
    commentColumn?: string;
    plannedHoursColumn: string;
    estimateHoursColumn: string;
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
  const plannedIdx = headerIndex(headers, columns.plannedHoursColumn);
  const estimateIdx = headerIndex(headers, columns.estimateHoursColumn);

  if (taskIdx < 0) return [];

  const rows: ScrumEstimateRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const taskCell = row[taskIdx]?.trim() ?? "";
    if (!taskCell) continue;
    const code =
      itemIdx >= 0 ? (row[itemIdx]?.trim() ?? "") : extractCodeFromTitle(taskCell) ?? "";
    const title = taskCell;
    rows.push({
      code,
      title,
      plannedHours: plannedIdx >= 0 ? parseHours(row[plannedIdx]) : null,
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

export async function loadScrumEstimateRowsFromSheet(options: {
  spreadsheetId: string;
  range?: string;
  plannedHoursColumn: string;
  estimateHoursColumn: string;
}): Promise<ScrumEstimateRow[]> {
  if (!isGoogleSheetsConfigured()) {
    throw new Error("Google Sheets credentials not configured");
  }
  const range = options.range ?? "A:Z";
  const values = await readSheetRows(options.spreadsheetId, range);
  return parseScrumEstimateSheet(values, {
    taskColumn: "Задача",
    plannedHoursColumn: options.plannedHoursColumn,
    estimateHoursColumn: options.estimateHoursColumn,
  });
}
