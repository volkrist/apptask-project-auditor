import "dotenv/config";
import { loadDbConfig, parseBoardIds } from "../src/collectors/db-config.js";
import { querySelect, closeDb } from "../src/collectors/db-client.js";

async function main(): Promise<void> {
  const boardIds = parseBoardIds(process.env.APPTASK_DB_BOARD_IDS ?? "783");
  const config = loadDbConfig({ boardIds });

  const cols = await querySelect<Record<string, unknown>>(
    config,
    `SELECT TOP 1 * FROM dbo.Boards WHERE id = @boardId`,
    { boardId: boardIds[0] ?? 783 },
  );
  console.log("Boards columns:", Object.keys(cols[0] ?? {}));
  console.log("Sample:", JSON.stringify(cols[0], null, 2));

  const tracking = await querySelect(
    config,
    `SELECT TOP 5 board_id, task_id, user_id, total_time, date
     FROM dbo.UserTrackingSummaries
     WHERE board_id = @boardId AND task_id IS NOT NULL AND removed = 0
     ORDER BY date DESC`,
    { boardId: boardIds[0] ?? 783 },
  );
  console.log("Tracking sample:", JSON.stringify(tracking, null, 2));

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
