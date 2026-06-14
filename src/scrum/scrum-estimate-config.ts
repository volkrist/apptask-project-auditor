/**
 * Scrum / estimate sheet matching — MVP assumptions documented in config.
 * Read-only: no writes to Google Sheets.
 */

export type ScrumEstimateConfig = {
  /** Approved estimate tab in work spreadsheet. */
  estimateSource: string;
  estimateSheetName: string;
  taskColumn: string;
  /** ПВ column in «Смета Декомпозиция». */
  pvColumn: string;
  estimateHoursColumn: string;
  subTaskColumn: string;
  matchMode: "title";
  approvedRule: "row_exists_in_estimate";
  workSpreadsheetId: string | null;
  /** Legacy Scrum portal sheet (not used for MVP matching). */
  scrumSpreadsheetId: string | null;
  scrumSheetGid: string | null;
  reviewQueueMax: number;
  decompositionHoursThreshold: number;
  staleWorkdayHours: number;
  matchDisclaimer: string;
};

export const DEFAULT_SCRUM_ESTIMATE_CONFIG: ScrumEstimateConfig = {
  estimateSource: "work_table_smeta_decomposition",
  estimateSheetName:
    process.env.SCRUM_ESTIMATE_SHEET_NAME?.trim() || "Смета Декомпозиция",
  taskColumn: process.env.SCRUM_TASK_COLUMN?.trim() || "Задача",
  pvColumn: process.env.SCRUM_PV_COLUMN?.trim() || "Оценка (ч)",
  estimateHoursColumn:
    process.env.SCRUM_ESTIMATE_HOURS_COLUMN?.trim() ||
    "Часы (с рисками). К смете",
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
    "Сопоставление AppTask ↔ смета выполнено по названию задачи. В Scrum-портале нет AppTask id/ссылки.",
};

export function loadScrumEstimateConfig(): ScrumEstimateConfig {
  return { ...DEFAULT_SCRUM_ESTIMATE_CONFIG };
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
  /** ПВ from «Оценка (ч)». */
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

/** @deprecated use pvColumn */
export function plannedHoursColumnName(config: ScrumEstimateConfig): string {
  return config.pvColumn;
}
