import {
  isGoogleSheetsConfigured,
  loadScrumEstimateConfig,
  type ScrumAuditContext,
} from "./scrum-estimate-config.js";
import { loadAllEstimateRows } from "./google-sheets-reader.js";

export async function loadScrumAuditContext(): Promise<ScrumAuditContext> {
  const config = loadScrumEstimateConfig();

  if (!isGoogleSheetsConfigured()) {
    return {
      config,
      rows: [],
      loaded: false,
      sources: [],
      loadError:
        "Google Sheets credentials not configured (GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY)",
    };
  }

  if (!config.scrumSpreadsheetId) {
    return {
      config,
      rows: [],
      loaded: false,
      sources: [],
      loadError: "GOOGLE_SCRUM_SPREADSHEET_ID not set",
    };
  }

  try {
    const { rows, sources, stats } = await loadAllEstimateRows(config);

    if (rows.length === 0) {
      const skipReasons = sources
        .filter((s) => s.source !== "work_optional")
        .map((s) => `${s.sheetName}: ${s.reason ?? s.status}`)
        .join("; ");
      return {
        config,
        rows: [],
        loaded: false,
        sources,
        loadError: skipReasons || "нет строк в Scrum-источниках (S1–S4 / Этап 2)",
        loadStats: stats,
      };
    }

    return {
      config,
      rows,
      loaded: true,
      sources,
      loadStats: stats,
    };
  } catch (err) {
    return {
      config,
      rows: [],
      loaded: false,
      sources: [],
      loadError: err instanceof Error ? err.message : String(err),
    };
  }
}
