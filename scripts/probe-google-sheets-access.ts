import "dotenv/config";
import {
  createReadOnlySheetsClient,
  readSheetRows,
} from "../src/scrum/google-sheets-reader.js";
import {
  isGoogleSheetsConfigured,
  loadScrumEstimateConfig,
} from "../src/scrum/scrum-estimate-config.js";
import { loadScrumAuditContext } from "../src/scrum/load-scrum-context.js";

const DASHBOARD_SPREADSHEET_ID =
  process.env.GOOGLE_PROJECTS_DASHBOARD_ID?.trim() ||
  "1x0BgQeakXeI_mNs2B7y2J126KnLwuPoKHhAQuKDqmo0";

const PROJECT_SEARCH = (process.env.GOOGLE_PROBE_PROJECT_NAME?.trim() || "TurboWeave")
  .toLowerCase();

function extractSpreadsheetId(value: string): string | null {
  const m = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}

function maskId(id: string | null | undefined): string {
  if (!id) return "(none)";
  if (id.length <= 8) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

type SheetInfo = { title: string; sheetId: number; index: number };

async function listSheets(spreadsheetId: string): Promise<SheetInfo[]> {
  const sheets = createReadOnlySheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,sheetId,index)",
  });
  return (res.data.sheets ?? [])
    .map((s) => ({
      title: s.properties?.title ?? "",
      sheetId: s.properties?.sheetId ?? 0,
      index: s.properties?.index ?? 0,
    }))
    .sort((a, b) => a.index - b.index);
}

function findHeaderIndex(headers: string[], ...names: string[]): number {
  const norms = names.map((n) => n.trim().toLowerCase());
  return headers.findIndex((h) => norms.includes(h.trim().toLowerCase()));
}

function rowMatchesProject(row: string[], headers: string[]): boolean {
  const joined = row.join(" ").toLowerCase();
  if (joined.includes(PROJECT_SEARCH)) return true;
  if (PROJECT_SEARCH.includes("turbo") && joined.includes("turbo weave")) {
    return true;
  }
  const nameIdx = findHeaderIndex(
    headers,
    "проект",
    "project",
    "название",
    "name",
  );
  if (nameIdx >= 0) {
    return (row[nameIdx] ?? "").toLowerCase().includes(PROJECT_SEARCH);
  }
  return false;
}

function pickSpreadsheetIdsFromRow(
  row: string[],
  headers: string[],
): { workId: string | null; scrumId: string | null } {
  let workId: string | null = null;
  let scrumId: string | null = null;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]?.toLowerCase() ?? "";
    const cell = row[i] ?? "";
    const id = extractSpreadsheetId(cell);
    if (!id) continue;
    if (
      header.includes("scrum") ||
      header.includes("портал") ||
      header.includes("portal")
    ) {
      scrumId = id;
    } else if (
      header.includes("рабоч") ||
      header.includes("work") ||
      header.includes("смет") ||
      header.includes("таблиц")
    ) {
      workId = id;
    } else if (!workId) {
      workId = id;
    } else if (!scrumId) {
      scrumId = id;
    }
  }

  for (const cell of row) {
    const id = extractSpreadsheetId(cell);
    if (!id) continue;
    if (!workId) workId = id;
    else if (!scrumId && id !== workId) scrumId = id;
  }

  return { workId, scrumId };
}

function hasColumn(headers: string[], name: string): boolean {
  const norm = name.trim().toLowerCase();
  return headers.some((h) => h.trim().toLowerCase() === norm);
}

function findEstimateHeaderRow(values: string[][]): {
  rowIndex: number;
  headers: string[];
} | null {
  for (let i = 0; i < Math.min(values.length, 40); i++) {
    const headers = (values[i] ?? []).map((h) => h.trim());
    if (
      hasColumn(headers, "Задача") ||
      hasColumn(headers, "Оценка (ч)")
    ) {
      return { rowIndex: i, headers };
    }
  }
  return null;
}

async function countScrumSheetsWithPvColumn(
  spreadsheetId: string,
  pvColumn: string,
): Promise<{ count: number; samples: string[] }> {
  const sheetList = await listSheets(spreadsheetId);
  const samples: string[] = [];
  for (const sheet of sheetList) {
    const escaped = sheet.title.replace(/'/g, "''");
    const vals = await readSheetRows(spreadsheetId, `'${escaped}'!A1:Z3`);
    const hit = vals.some((row) => hasColumn(row.map((h) => h.trim()), pvColumn));
    if (hit) {
      samples.push(sheet.title);
    }
  }
  return { count: samples.length, samples };
}

async function probeSpreadsheet(
  label: string,
  spreadsheetId: string,
  estimateSheetName: string,
  pvColumn: string,
): Promise<void> {
  console.log(`--- ${label} (${maskId(spreadsheetId)}) ---`);
  try {
    const sheetList = await listSheets(spreadsheetId);
    console.log(`Sheets (${sheetList.length}): ${sheetList.map((s) => s.title).join(" | ")}`);

    const hasEstimate = sheetList.some((s) => s.title === estimateSheetName);
    console.log(`Sheet «${estimateSheetName}»: ${hasEstimate ? "yes" : "no"}`);

    let estimateRawRows = 0;
    let estimateParsedHint = "";
    if (hasEstimate) {
      const range = `'${estimateSheetName.replace(/'/g, "''")}'!A:Z`;
      const values = await readSheetRows(spreadsheetId, range);
      estimateRawRows = values.length;
      const headerInfo = findEstimateHeaderRow(values);
      const headers = headerInfo?.headers ?? values[0]?.map((h) => h.trim()) ?? [];
      const hasPv = hasColumn(headers, pvColumn);
      const hasTask = hasColumn(headers, "Задача");
      const headerAt =
        headerInfo != null ? `row ${headerInfo.rowIndex + 1}` : "not found in first 40 rows";
      estimateParsedHint = `header at ${headerAt}; «${pvColumn}»=${hasPv ? "yes" : "no"}; «Задача»=${hasTask ? "yes" : "no"}`;
      console.log(`«${estimateSheetName}» raw rows: ${estimateRawRows}`);
      console.log(estimateParsedHint);
      if (headers.length && headerInfo) {
        console.log(
          `Header sample: ${headers.filter((h) => h).slice(0, 10).join(" | ")}`,
        );
      }
    }

    const pvScan = await countScrumSheetsWithPvColumn(spreadsheetId, pvColumn);
    if (label.includes("Scrum") && pvScan.count > 0) {
      console.log(
        `«${pvColumn}» column found on ${pvScan.count} tab(s): ${pvScan.samples.slice(0, 6).join(" | ")}${pvScan.samples.length > 6 ? " …" : ""}`,
      );
    } else if (label.includes("Scrum")) {
      console.log(`«${pvColumn}» column: not found on any tab (first 3 rows scanned)`);
    }

    const scrumGid = loadScrumEstimateConfig().scrumSheetGid;
    const scrumSheet =
      sheetList.find((s) => String(s.sheetId) === scrumGid) ??
      sheetList.find((s) => /scrum|портал|portal/i.test(s.title));

    if (scrumSheet && label.includes("Scrum") && pvScan.count === 0) {
      const range = `'${scrumSheet.title.replace(/'/g, "''")}'!A1:Z1`;
      const headerRow = await readSheetRows(spreadsheetId, range);
      const headers = headerRow[0]?.map((h) => h.trim()) ?? [];
      console.log(
        `Scrum tab «${scrumSheet.title}»: «${pvColumn}» column ${hasColumn(headers, pvColumn) ? "yes" : "no"}`,
      );
      if (headers.length) {
        console.log(`Scrum headers sample: ${headers.slice(0, 12).join(" | ")}`);
      }
    } else if (label.includes("Scrum")) {
      const first = sheetList[0];
      if (first) {
        const range = `'${first.title.replace(/'/g, "''")}'!A1:Z1`;
        const headerRow = await readSheetRows(spreadsheetId, range);
        const headers = headerRow[0]?.map((h) => h.trim()) ?? [];
        console.log(
          `First tab «${first.title}»: «${pvColumn}» column ${hasColumn(headers, pvColumn) ? "yes" : "no"}`,
        );
        if (headers.length) {
          console.log(`Headers sample: ${headers.slice(0, 12).join(" | ")}`);
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`ERROR: ${msg}`);
  }
  console.log("");
}

async function main(): Promise<void> {
  console.log("=== Google Sheets access probe (read-only) ===");
  console.log(`Configured: ${isGoogleSheetsConfigured()}`);
  console.log(`Service account: ${process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL?.trim() ?? "(not set)"}`);
  console.log(`READONLY flag: ${process.env.GOOGLE_SHEETS_READONLY ?? "(not set)"}`);
  console.log(`Project search: ${PROJECT_SEARCH}`);
  console.log("");

  if (!isGoogleSheetsConfigured()) {
    console.log("SKIP: set GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, GOOGLE_SHEETS_READONLY=true");
    process.exit(1);
  }

  const config = loadScrumEstimateConfig();

  // 1. Dashboard
  console.log(`--- Projects dashboard (${maskId(DASHBOARD_SPREADSHEET_ID)}) ---`);
  let dashboardOk = false;
  let turboFound = false;
  let dashboardWorkId: string | null = null;
  let dashboardScrumId: string | null = null;

  try {
    const dashSheets = await listSheets(DASHBOARD_SPREADSHEET_ID);
    console.log(`Sheets (${dashSheets.length}): ${dashSheets.map((s) => s.title).join(" | ")}`);
    const firstTab = dashSheets[0]?.title ?? "Sheet1";
    const values = await readSheetRows(DASHBOARD_SPREADSHEET_ID, `'${firstTab.replace(/'/g, "''")}'!A:Z`);
    console.log(`Dashboard raw rows (first tab): ${values.length}`);
    dashboardOk = values.length > 0;

    const headers = values[0]?.map((h) => h.trim()) ?? [];
    if (headers.length) {
      console.log(`Dashboard headers: ${headers.join(" | ")}`);
    }

    for (let i = 1; i < values.length; i++) {
      const row = values[i] ?? [];
      if (!rowMatchesProject(row, headers)) continue;
      turboFound = true;
      const ids = pickSpreadsheetIdsFromRow(row, headers);
      dashboardWorkId = ids.workId;
      dashboardScrumId = ids.scrumId;
      const workLabel = row[1]?.trim() || "(empty)";
      const scrumLabel = row[8]?.trim() || "(empty)";
      console.log(`TurboWeave row #${i + 1}:`);
      console.log(`  project: ${row[0]?.trim() ?? ""}`);
      console.log(`  work link cell: ${workLabel}`);
      console.log(`  scrum link cell: ${scrumLabel}`);
      if (ids.workId || ids.scrumId) {
        console.log(
          `  extracted ids: work=${maskId(ids.workId)} scrum=${maskId(ids.scrumId)}`,
        );
      } else {
        console.log(
          "  note: dashboard cells contain labels, not spreadsheet URLs in values API — use GOOGLE_WORK_SPREADSHEET_ID / GOOGLE_SCRUM_SPREADSHEET_ID",
        );
      }
      break;
    }
    console.log(`TurboWeave in dashboard: ${turboFound ? "yes" : "no"}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Dashboard ERROR: ${msg}`);
  }
  console.log("");

  const workId =
    process.env.GOOGLE_WORK_SPREADSHEET_ID?.trim() ||
    dashboardWorkId ||
    config.workSpreadsheetId;
  const scrumId =
    process.env.GOOGLE_SCRUM_SPREADSHEET_ID?.trim() ||
    dashboardScrumId ||
    config.scrumSpreadsheetId;

  if (workId) {
    await probeSpreadsheet(
      "Work table",
      workId,
      config.workEstimateSheetName,
      config.pvColumn,
    );
  }

  if (scrumId) {
    await probeSpreadsheet(
      "Scrum portal",
      scrumId,
      config.workEstimateSheetName,
      config.pvColumn,
    );
  }

  console.log("--- Existing probe: loadScrumAuditContext ---");
  const ctx = await loadScrumAuditContext();
  console.log(`Loaded: ${ctx.loaded}`);
  if (ctx.loadError) console.log(`Load error: ${ctx.loadError}`);
  console.log(`Estimate rows parsed: ${ctx.rows.length}`);
  console.log(`Work spreadsheet (config): ${maskId(ctx.config.workSpreadsheetId)}`);
  console.log(`Estimate tab (optional work): «${ctx.config.workEstimateSheetName}»`);
  console.log(`PV column: «${ctx.config.pvColumn}»`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
