import "dotenv/config";
import { loadScrumAuditContext } from "../src/scrum/load-scrum-context.js";
import {
  isGoogleSheetsConfigured,
  loadScrumEstimateConfig,
} from "../src/scrum/scrum-estimate-config.js";
import {
  computeScrumMatchStats,
  matchTaskToEstimate,
} from "../src/scrum/estimate-matcher.js";
import type { RawTask } from "../src/adapters/apptask/types.js";
import { emptyRawTask } from "../src/adapters/apptask/types.js";

function task(title: string): RawTask {
  return { ...emptyRawTask(), title, status: "В процессе" };
}

async function main(): Promise<void> {
  const config = loadScrumEstimateConfig();
  console.log("=== Scrum / Estimate Probe (read-only Google Sheets) ===");
  console.log(`Google configured: ${isGoogleSheetsConfigured()}`);
  console.log(`Scrum boards: ${config.scrumBoardIds.join(", ")}`);
  console.log("");

  const ctx = await loadScrumAuditContext();
  console.log(`Loaded: ${ctx.loaded}`);
  console.log(`Scrum spreadsheet: ${ctx.config.scrumSpreadsheetId}`);
  console.log(`PV column: ${ctx.config.pvColumn}`);
  console.log(`Match mode: ${ctx.config.matchMode}`);
  if (ctx.loadError) {
    console.log(`Load error: ${ctx.loadError}`);
  }

  if (ctx.loadStats) {
    const s = ctx.loadStats;
    console.log("");
    console.log("--- Dedup summary ---");
    console.log(`API raw rows (sheet lines, primary sources): ${s.apiRawRows}`);
    console.log(`Parsed task rows (before dedup): ${s.parsedRowsBeforeDedup}`);
    console.log(`Unique rows (after dedup): ${s.uniqueRows}`);
    console.log(`Duplicates removed: ${s.duplicatesRemoved}`);
    console.log(
      "Note: per-sheet parsed= counts are before cross-sheet dedup; unique rows = merged set.",
    );
  } else {
    console.log(`Total estimate rows: ${ctx.rows.length}`);
  }
  console.log("");

  if (ctx.sources.length > 0) {
    console.log("--- Sources ---");
    for (const s of ctx.sources) {
      const note = s.reason ? ` | ${s.reason}` : "";
      const added =
        s.mergedAddedRows != null ? ` added=${s.mergedAddedRows}` : "";
      console.log(
        `${s.source} | ${s.sheetName} | ${s.status} | apiRaw=${s.rawRows} parsed=${s.parsedRows}${added}${note}`,
      );
    }
    console.log("");
  }

  if (ctx.rows.length > 0) {
    console.log("--- Sample estimate rows (first 5) ---");
    for (const row of ctx.rows.slice(0, 5)) {
      console.log(
        JSON.stringify({
          sheet: row.sourceSheet,
          fullTitle: row.fullTitle.slice(0, 80),
          pv: row.estimateHours,
          subtask: row.subtaskTitle?.slice(0, 40) ?? null,
        }),
      );
    }
    console.log("");

    const samples = [
      ctx.rows[0]?.fullTitle ?? "3.2.1 UI: HUD",
      "9.9.9 Unknown task title",
    ];
    console.log("--- Title matching samples ---");
    for (const title of samples) {
      const m = matchTaskToEstimate(task(title), ctx.rows);
      console.log(
        `title=${JSON.stringify(title.slice(0, 60))} → kind=${m.kind}`,
      );
    }
    console.log("");

    const sampleTasks = ctx.rows.slice(0, 20).map((r) => task(r.fullTitle));
    const stats = computeScrumMatchStats(sampleTasks, ctx.rows);
    console.log("--- Match stats (sample tasks from estimate) ---");
    console.log(JSON.stringify(stats, null, 2));
  } else if (!ctx.loaded) {
    console.log(
      "Rules will SKIP with reason:",
      ctx.loadError ?? "not configured",
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
