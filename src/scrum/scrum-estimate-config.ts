/**
 * Scrum / estimate sheet matching — MVP assumptions documented in config.
 * Read-only: no writes to Google Sheets.
 */

export type ScrumEstimateConfig = {
  estimateSource: string;
  /** Optional work-table tab (SKIP if non-standard structure). */
  workEstimateSheetName: string;
  /** Scrum portal sprint tabs S1–S4 (primary). */
  sprintSheetPattern: RegExp;
  sprintSheetExcludePattern: RegExp;
  /** Scrum portal decomposition fallback tab. */
  decompositionSheetName: string;
  taskColumn: string;
  pvColumn: string;
  estimateHoursColumn: string;
  subTaskColumn: string;
  matchMode: "title";
  approvedRule: "row_exists_in_estimate";
  workSpreadsheetId: string | null;
  scrumSpreadsheetId: string | null;
  scrumSheetGid: string | null;
  reviewQueueMax: number;
  decompositionHoursThreshold: number;
  staleWorkdayHours: number;
  matchDisclaimer: string;
  headerScanRows: number;
  /** AppTask board ids with linked Scrum/estimate source (MVP: TurboWeave = 783). */
  scrumBoardIds: string[];
};

export const DEFAULT_SCRUM_ESTIMATE_CONFIG: ScrumEstimateConfig = {
  estimateSource: "scrum_portal_s1_s4_plus_decomposition",
  workEstimateSheetName:
    process.env.SCRUM_ESTIMATE_SHEET_NAME?.trim() || "Смета Декомпозиция",
  sprintSheetPattern: /🚦S[1-4]\s|S[1-4]\s*-\s/i,
  sprintSheetExcludePattern: /🚦S0\s|S0\s*—|S0\s*-.*шаблон/i,
  decompositionSheetName:
    process.env.SCRUM_DECOMPOSITION_SHEET_NAME?.trim() ||
    "Этап 2. Декомпозиция",
  taskColumn: process.env.SCRUM_TASK_COLUMN?.trim() || "Задача",
  pvColumn: process.env.SCRUM_PV_COLUMN?.trim() || "Оценка (ч)",
  estimateHoursColumn:
    process.env.SCRUM_ESTIMATE_HOURS_COLUMN?.trim() ||
    "Часы (оценка стаса). В Апптаск",
  subTaskColumn: process.env.SCRUM_SUBTASK_COLUMN?.trim() || "Под Задача",
  matchMode: "title",
  approvedRule: "row_exists_in_estimate",
  workSpreadsheetId:
    process.env.GOOGLE_WORK_SPREADSHEET_ID?.trim() ||
    "1aNFtgJbvGQ5EuQJNoSNkT1RK3KCl046939Ha42qKCFY",
  scrumSpreadsheetId:
    process.env.GOOGLE_SCRUM_SPREADSHEET_ID?.trim() ||
    "1xh2xDxnPx_e7fbfa3x-6Ok1_9FkRVrNC4hY4UbjJuUw",
  scrumSheetGid: process.env.GOOGLE_SCRUM_SHEET_GID?.trim() || "1949461145",
  reviewQueueMax: Number(process.env.SCRUM_REVIEW_QUEUE_MAX ?? "10") || 10,
  decompositionHoursThreshold: 20,
  staleWorkdayHours: 24,
  matchDisclaimer:
    "Сопоставление AppTask ↔ Scrum/смета выполнено по названию задачи. AppTask id/ссылки в Scrum нет.",
  headerScanRows: 80,
  scrumBoardIds: parseScrumBoardIdsFromEnv(),
};

/** @deprecated use workEstimateSheetName */
export function estimateSheetName(config: ScrumEstimateConfig): string {
  return config.workEstimateSheetName;
}

export function loadScrumEstimateConfig(): ScrumEstimateConfig {
  return { ...DEFAULT_SCRUM_ESTIMATE_CONFIG };
}

export function parseScrumBoardIdsFromEnv(
  raw = process.env.SCRUM_BOARD_IDS,
): string[] {
  const text = raw?.trim() || "783";
  return [...new Set(text.split(/[,;\s]+/).map((id) => id.trim()).filter(Boolean))];
}

export function isScrumAuditBoard(
  boardId: string | null | undefined,
  config: ScrumEstimateConfig = loadScrumEstimateConfig(),
): boolean {
  if (!boardId?.trim()) return false;
  return config.scrumBoardIds.includes(boardId.trim());
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim() &&
      process.env.GOOGLE_SHEETS_READONLY?.trim().toLowerCase() !== "false",
  );
}

export function isSprintSheetName(
  sheetName: string,
  config: ScrumEstimateConfig,
): boolean {
  if (config.sprintSheetExcludePattern.test(sheetName)) return false;
  return config.sprintSheetPattern.test(sheetName);
}

export type ScrumEstimateRow = {
  sourceSheet: string;
  rowIndex: number;
  taskTitle: string;
  subtaskTitle: string | null;
  fullTitle: string;
  estimateHours: number | null;
  /** Legacy fields kept for rules/reports. */
  code: string;
  title: string;
  plannedHours: number | null;
  estimateHoursRisk: number | null;
  subTask: string | null;
  comment: string | null;
  raw: Record<string, string>;
};

export type ScrumSourceLoadStatus = {
  source: "sprint" | "decomposition" | "work_optional";
  sheetName: string;
  status: "ok" | "skip" | "error";
  /** Sheet line count from Google API (includes header/memo rows). */
  rawRows: number;
  /** Task rows parsed from this sheet (before cross-sheet dedup). */
  parsedRows: number;
  /** Rows added to merged set after dedup with prior sheets. */
  mergedAddedRows?: number;
  reason?: string;
};

export type EstimateLoadStats = {
  apiRawRows: number;
  parsedRowsBeforeDedup: number;
  uniqueRows: number;
  duplicatesRemoved: number;
};

export type ScrumAuditContext = {
  config: ScrumEstimateConfig;
  rows: ScrumEstimateRow[];
  loaded: boolean;
  loadError?: string;
  sources: ScrumSourceLoadStatus[];
  loadStats?: EstimateLoadStats;
};

export type BoardQueueMetrics = {
  boardId: string;
  testingQueueCount: number;
  testingQueueMax: number;
  sampleTasks: Array<{ id: string; url: string; title: string | null }>;
};

export type BoardAuditMetrics = {
  reviewQueueCount: number;
  reviewQueueMax: number;
  byBoard: Record<string, BoardQueueMetrics>;
};

/** @deprecated use pvColumn */
export function plannedHoursColumnName(config: ScrumEstimateConfig): string {
  return config.pvColumn;
}
