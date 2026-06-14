/**
 * Scrum / estimate sheet matching — MVP assumptions documented in config.
 * Read-only: no writes to Google Sheets.
 */

export type ScrumEstimateConfig = {
  estimateSource: string;
  plannedHoursColumn: string;
  estimateHoursColumn: string;
  matchMode: "code_and_title";
  approvedRule: "row_exists_in_estimate";
  /** Spreadsheet id for Scrum portal (read-only). */
  scrumSpreadsheetId: string | null;
  /** Gid / sheet name for estimate tab. */
  scrumSheetGid: string | null;
  workSpreadsheetId: string | null;
  reviewQueueMax: number;
  decompositionHoursThreshold: number;
  staleWorkdayHours: number;
  matchDisclaimer: string;
};

export const DEFAULT_SCRUM_ESTIMATE_CONFIG: ScrumEstimateConfig = {
  estimateSource: "smeta_decomposition",
  plannedHoursColumn: "Часы (оценка стаса). В Апптаск",
  estimateHoursColumn: "Часы (с рисками). К смете",
  matchMode: "code_and_title",
  approvedRule: "row_exists_in_estimate",
  scrumSpreadsheetId:
    process.env.GOOGLE_SCRUM_SPREADSHEET_ID?.trim() ||
    "1xh2xDxnPx_e7fbfa3x-6Ok1_9FkRVrNC4hY4UbjJuUw",
  scrumSheetGid: process.env.GOOGLE_SCRUM_SHEET_GID?.trim() || "1949461145",
  workSpreadsheetId:
    process.env.GOOGLE_WORK_SPREADSHEET_ID?.trim() ||
    "1aNFtgJbvGQ5EuQJNoSNkT1RK3KCl046939Ha42qKCFY",
  reviewQueueMax: Number(process.env.SCRUM_REVIEW_QUEUE_MAX ?? "10") || 10,
  decompositionHoursThreshold: 20,
  staleWorkdayHours: 24,
  matchDisclaimer:
    "Сверка со сметой выполнена по коду/названию. Для 100% точности нужна колонка AppTask URL или AppTask ID.",
};

export function loadScrumEstimateConfig(): ScrumEstimateConfig {
  return {
    ...DEFAULT_SCRUM_ESTIMATE_CONFIG,
    plannedHoursColumn:
      process.env.SCRUM_PLANNED_HOURS_COLUMN?.trim() ||
      DEFAULT_SCRUM_ESTIMATE_CONFIG.plannedHoursColumn,
    estimateHoursColumn:
      process.env.SCRUM_ESTIMATE_HOURS_COLUMN?.trim() ||
      DEFAULT_SCRUM_ESTIMATE_CONFIG.estimateHoursColumn,
  };
}

export function isGoogleSheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim() &&
      process.env.GOOGLE_SHEETS_PRIVATE_KEY?.trim() &&
      process.env.GOOGLE_SHEETS_READONLY?.trim().toLowerCase() !== "false",
  );
}

export type ScrumEstimateRow = {
  code: string;
  title: string;
  plannedHours: number | null;
  estimateHours: number | null;
  subTask: string | null;
  comment: string | null;
  raw: Record<string, string>;
};

export type ScrumAuditContext = {
  config: ScrumEstimateConfig;
  rows: ScrumEstimateRow[];
  loaded: boolean;
  loadError?: string;
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
