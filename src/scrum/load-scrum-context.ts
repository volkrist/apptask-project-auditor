import {
  isGoogleSheetsConfigured,
  loadScrumEstimateConfig,
  type ScrumAuditContext,
} from "./scrum-estimate-config.js";
import { loadApprovedEstimateRows } from "./google-sheets-reader.js";

export async function loadScrumAuditContext(): Promise<ScrumAuditContext> {
  const config = loadScrumEstimateConfig();

  if (!isGoogleSheetsConfigured()) {
    return {
      config,
      rows: [],
      loaded: false,
      loadError:
        "Google Sheets credentials not configured (GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY)",
    };
  }

  if (!config.workSpreadsheetId) {
    return {
      config,
      rows: [],
      loaded: false,
      loadError: "GOOGLE_WORK_SPREADSHEET_ID not set",
    };
  }

  try {
    const rows = await loadApprovedEstimateRows(config);
    return {
      config,
      rows,
      loaded: true,
    };
  } catch (err) {
    return {
      config,
      rows: [],
      loaded: false,
      loadError: err instanceof Error ? err.message : String(err),
    };
  }
}
