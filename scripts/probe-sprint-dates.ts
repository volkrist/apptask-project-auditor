import "dotenv/config";
import {
  createReadOnlySheetsClient,
  listSpreadsheetSheetTitles,
  readSheetRows,
} from "../src/scrum/google-sheets-reader.js";
import { loadScrumEstimateConfig } from "../src/scrum/scrum-estimate-config.js";

async function probeSprintSheets(): Promise<void> {
  const config = loadScrumEstimateConfig();
  if (!config.scrumSpreadsheetId) {
    console.log("No scrum spreadsheet id");
    return;
  }
  const titles = await listSpreadsheetSheetTitles(config.scrumSpreadsheetId);
  console.log("Scrum sheets:", titles.filter((t) => /S[0-4]/i.test(t)));

  const sprintSheets = titles.filter(
    (t) => config.sprintSheetPattern.test(t) && !config.sprintSheetExcludePattern.test(t),
  );
  for (const name of sprintSheets.slice(0, 4)) {
    const rows = await readSheetRows(config.scrumSpreadsheetId, `'${name.replace(/'/g, "''")}'!A1:Z100`);
    console.log(`\n=== ${name} (${rows.length} rows) ===`);
    for (const row of rows.slice(0, 15)) {
      const line = row.join(" | ").slice(0, 200);
      if (/дата|date|период|спринт|start|end|этап/i.test(line) || row.some((c) => /\d{1,2}\.\d{1,2}\.\d{2,4}/.test(c ?? ""))) {
        console.log(">>", line);
      }
    }
    // scan all for dates
    for (let i = 0; i < Math.min(rows.length, 100); i++) {
      for (const cell of rows[i] ?? []) {
        if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(cell ?? "") || /202[0-9]-/.test(cell ?? "")) {
          console.log(`  row ${i + 1}:`, rows[i]?.join(" | ").slice(0, 150));
          break;
        }
      }
    }
  }
}

async function probeWorkSheet(): Promise<void> {
  const config = loadScrumEstimateConfig();
  if (!config.workSpreadsheetId) {
    console.log("\nNo work spreadsheet id");
    return;
  }
  const titles = await listSpreadsheetSheetTitles(config.workSpreadsheetId);
  console.log("\nWork sheets:", titles.slice(0, 20));
  const turbo = titles.find((t) => /turbo|weave/i.test(t));
  if (turbo) {
    const rows = await readSheetRows(config.workSpreadsheetId, `'${turbo.replace(/'/g, "''")}'!A1:Z30`);
    console.log(`\n=== Work tab: ${turbo} ===`);
    for (const row of rows.slice(0, 20)) {
      console.log(row.join(" | ").slice(0, 200));
    }
  }
}

probeSprintSheets()
  .then(() => probeWorkSheet())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
