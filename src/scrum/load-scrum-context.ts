import {
  isGoogleSheetsConfigured,
  loadScrumEstimateConfig,
  type ScrumAuditContext,
} from "./scrum-estimate-config.js";
import { loadScrumEstimateRowsFromSheet } from "./google-sheets-reader.js";

export async function loadScrumAuditContext(): Promise<ScrumAuditContext | null> {
  if (!isGoogleSheetsConfigured()) {
    return null;
  }

  const config = loadScrumEstimateConfig();
  if (!config.scrumSpreadsheetId) {
    return {
      config,
      rows: [],
      loaded: false,
      loadError: "GOOGLE_SCRUM_SPREADSHEET_ID not set",
    };
  }

  try {
    const rows = await loadScrumEstimateRowsFromSheet({
      spreadsheetId: config.scrumSpreadsheetId,
      plannedHoursColumn: config.plannedHoursColumn,
      estimateHoursColumn: config.estimateHoursColumn,
    });
    return { config, rows, loaded: true };
  } catch (err) {
    return {
      config,
      rows: [],
      loaded: false,
      loadError: err instanceof Error ? err.message : String(err),
    };
  }
}
