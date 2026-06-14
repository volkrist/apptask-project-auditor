import "dotenv/config";
import { loadScrumAuditContext } from "../src/scrum/load-scrum-context.js";
import { isGoogleSheetsConfigured } from "../src/scrum/scrum-estimate-config.js";
import { matchTaskToEstimate } from "../src/scrum/estimate-matcher.js";
import type { RawTask } from "../src/adapters/apptask/types.js";
import { emptyRawTask } from "../src/adapters/apptask/types.js";

function task(title: string): RawTask {
  return { ...emptyRawTask(), title, status: "В процессе" };
}

async function main(): Promise<void> {
  console.log("=== Scrum / Estimate Probe (read-only Google Sheets) ===");
  console.log(`Google configured: ${isGoogleSheetsConfigured()}`);
  console.log("");

  const ctx = await loadScrumAuditContext();
  console.log(`Loaded: ${ctx.loaded}`);
  console.log(`Sheet: ${ctx.config.workSpreadsheetId} / «${ctx.config.estimateSheetName}»`);
  console.log(`PV column: ${ctx.config.pvColumn}`);
  console.log(`Match mode: ${ctx.config.matchMode}`);
  if (ctx.loadError) {
    console.log(`Load error: ${ctx.loadError}`);
  }
  console.log(`Rows in estimate: ${ctx.rows.length}`);
  console.log("");

  if (ctx.rows.length > 0) {
    console.log("--- Sample estimate rows (first 5) ---");
    for (const row of ctx.rows.slice(0, 5)) {
      console.log(
        JSON.stringify({
          title: row.title.slice(0, 80),
          pv: row.plannedHours,
          subTask: row.subTask?.slice(0, 40) ?? null,
        }),
      );
    }
    console.log("");

    const samples = [
      ctx.rows[0]?.title ?? "3.2.1 UI: HUD",
      "9.9.9 Unknown task title",
      ctx.rows[0]?.title
        ? `${ctx.rows[0].title} (modified)`
        : "Modified title",
    ];
    console.log("--- Title matching samples ---");
    for (const title of samples) {
      const m = matchTaskToEstimate(task(title), ctx.rows);
      console.log(
        `title=${JSON.stringify(title.slice(0, 60))} → kind=${m.kind}`,
      );
    }
  } else if (!ctx.loaded) {
    console.log(
      "Rules will SKIP with reason:",
      ctx.loadError ?? "not configured",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
