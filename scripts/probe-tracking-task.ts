/**
 * Probe fact tracking hours for specific tasks (UI verification).
 *
 * npm run probe:tracking:task -- --board-id 783 --task-ids 1,3,4,5
 */
import "dotenv/config";
import { loadDbConfig } from "../src/collectors/db-config.js";
import { closeDb } from "../src/collectors/db-client.js";
import { loadTaskTrackingProbeRows } from "../src/tracking/tracking-hours-reader.js";

function parseArgs(argv: string[]): { boardId: number | null; taskIds: number[] } {
  let boardId: number | null = null;
  const taskIds: number[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--board-id" && argv[i + 1]) {
      boardId = Number(argv[++i]);
    } else if (arg.startsWith("--board-id=")) {
      boardId = Number(arg.slice("--board-id=".length));
    } else if (arg === "--task-ids" && argv[i + 1]) {
      taskIds.push(...parseTaskIds(argv[++i]!));
    } else if (arg.startsWith("--task-ids=")) {
      taskIds.push(...parseTaskIds(arg.slice("--task-ids=".length)));
    }
  }

  return { boardId, taskIds: [...new Set(taskIds.filter((id) => id > 0))] };
}

function parseTaskIds(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function fmtHours(h: number): string {
  return h.toFixed(4);
}

function fmtMs(ms: number): string {
  return ms.toLocaleString("en-US");
}

async function main(): Promise<void> {
  const { boardId, taskIds } = parseArgs(process.argv.slice(2));

  if (boardId == null || !Number.isFinite(boardId) || taskIds.length === 0) {
    console.error(
      "Usage: npm run probe:tracking:task -- --board-id 783 --task-ids 1,3,4,5",
    );
    process.exit(1);
  }

  const config = loadDbConfig({ boardIds: [boardId] });

  console.log("=== Tracking task probe (read-only SELECT) ===");
  console.log(`Board ID: ${boardId}`);
  console.log(`Task IDs: ${taskIds.join(", ")}`);
  console.log("Source: dbo.UserTrackingSummaries (removed=0, task_id IS NOT NULL)");
  console.log("Units: milliseconds → hours = totalMs / 3_600_000");
  console.log("");

  try {
    const rows = await loadTaskTrackingProbeRows(
      config,
      boardId,
      taskIds,
      config.appTaskBaseUrl,
    );

    for (const row of rows) {
      console.log(`## Task #${row.taskId} (board ${row.boardId})`);
      console.log(`title: ${row.title ?? "(unknown)"}`);
      console.log(`status: ${row.statusName ?? "—"}`);
      console.log(
        `assignees: ${row.assigneeNames.length ? row.assigneeNames.join(", ") : "—"}`,
      );
      console.log(`url: ${row.taskUrl}`);
      console.log(
        `total: ${fmtHours(row.totalHours)} h (${fmtMs(row.totalMs)} ms) | users=${row.usersCount} | days=${row.trackingDaysCount}`,
      );
      console.log(
        `dates: ${row.firstTrackingDate ?? "—"} .. ${row.lastTrackingDate ?? "—"}`,
      );
      console.log(
        `raw total_time: ${fmtMs(row.rawTotalTimeMs)} ms | raw append_total_time: ${fmtMs(row.rawAppendTotalTimeMs)} ms`,
      );

      if (row.perUser.length === 0) {
        console.log("perUser: (no tracking rows)");
      } else {
        console.log("perUser:");
        for (const u of row.perUser) {
          console.log(
            `  user ${u.userId}${u.userName ? ` (${u.userName})` : ""}: ${fmtHours(u.totalHours)} h (${fmtMs(u.totalMs)} ms) | ${u.firstDate ?? "?"} .. ${u.lastDate ?? "?"}`,
          );
        }
      }
      console.log("");
    }

    console.log("## UI check");
    console.log(
      "Compare totalHours with tracked time shown in AppTask task card for each task above.",
    );
    console.log(
      "If UI hours ≈ totalHours (± rounding), units are milliseconds.",
    );
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
