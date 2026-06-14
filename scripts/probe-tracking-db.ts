import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { closeDb, querySelect } from "../src/collectors/db-client.js";

const TRACKING_TABLES = [
  "UserTrackings",
  "UserTrackingSummaries",
  "UserTrackingAreas",
  "UserTrackingAreaReports",
  "UserTrackingManualChanges",
  "UserTrackingProcess",
  "UserTrackingIOs",
  "UserTrackingScreens",
  "TrackingUpdateMarks",
] as const;

type ColumnRow = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
};

async function main(): Promise<void> {
  const config = loadDbConfig();
  console.log("=== Tracking tables probe (read-only SELECT) ===\n");

  for (const table of TRACKING_TABLES) {
    console.log(`--- dbo.${table} ---`);
    try {
      const columns = await querySelect<ColumnRow>(
        config,
        `
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = @tableName
ORDER BY ORDINAL_POSITION
`,
        { tableName: table },
      );
      if (columns.length === 0) {
        console.log("  (table not found or no access)\n");
        continue;
      }
      console.log(
        "  columns:",
        columns.map((c) => `${c.COLUMN_NAME}:${c.DATA_TYPE}`).join(", "),
      );

      const sample = await querySelect<Record<string, unknown>>(
        config,
        `SELECT TOP 3 * FROM dbo.[${table}]`,
      );
      console.log(`  sample rows: ${sample.length}`);
      for (const row of sample) {
        const preview = Object.entries(row)
          .slice(0, 8)
          .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
          .join("; ");
        console.log(`    ${preview}`);
      }
    } catch (err) {
      console.log(
        `  error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    console.log("");
  }

  console.log(
    "TODO: определить board_id, task_id, duration/hours в tracking-таблицах перед правилами факт-часов.",
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
