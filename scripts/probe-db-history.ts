import "dotenv/config";
import { loadDbConfig, parseBoardIds } from "../src/collectors/db-config.js";
import { closeDb } from "../src/collectors/db-client.js";
import {
  fetchActiveTasks,
  fetchHistories,
  fetchBoardStates,
} from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import {
  buildStateNameByKey,
  makeStateNameResolver,
} from "../src/collectors/state-map.js";
import {
  extractStatusFromChanges,
  findReviewStartedAt,
  findReworkTransitions,
  parseHistoryData,
  summarizeActionTypes,
} from "../src/rules/history/history-parser.js";
import { isTestingStatus } from "../src/rules/status/status-helpers.js";

function parseArgs(argv: string[]): number[] {
  const ids: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--board-ids" && argv[i + 1]) {
      ids.push(...parseBoardIds(argv[++i]));
    } else if (a.startsWith("--board-ids=")) {
      ids.push(...parseBoardIds(a.slice("--board-ids=".length)));
    }
  }
  return ids;
}

async function main(): Promise<void> {
  const fromArgv = parseArgs(process.argv.slice(2));
  const boardIds =
    fromArgv.length > 0 ? fromArgv : parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);
  const config = loadDbConfig({ boardIds });

  console.log("=== DB History Probe (read-only SELECT) ===");
  console.log(`Board IDs: ${boardIds.join(", ") || "(none)"}`);
  console.log("");

  try {
    const [tasks, histories, boardStates] = await Promise.all([
      fetchActiveTasks(config, boardIds),
      fetchHistories(config, boardIds),
      fetchBoardStates(config, boardIds),
    ]);

    const stateNameByKey = buildStateNameByKey(boardStates);
    const resolve = makeStateNameResolver(stateNameByKey);
    console.log(`Board states loaded: ${boardStates.length}`);

    console.log(`SQL history rows: ${histories.length}`);
    const rawTasks = mapDbBundleToRawTasks(
      { tasks, assignees: [], tags: [], comments: [], histories },
      config.appTaskBaseUrl,
    );
    console.log(`Mapped tasks: ${rawTasks.length}`);
    console.log("");

    const actionCounts = summarizeActionTypes(
      rawTasks.flatMap((t) => t.history ?? []),
    );
    console.log("--- action_type counts ---");
    const sortedActions = [...actionCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [type, count] of sortedActions.slice(0, 30)) {
      console.log(`  action_type=${type}: ${count}`);
    }
    console.log("");

    const statusSamples: string[] = [];
    for (const h of histories) {
      const changes = parseHistoryData(h.data);
      const statusChange = extractStatusFromChanges(
        changes,
        String(h.board_id),
        resolve,
      );
      if (!statusChange) continue;
      statusSamples.push(
        JSON.stringify({
          boardId: h.board_id,
          taskId: h.task_id,
          actionType: h.action_type,
          date: h.date,
          from: statusChange.from,
          to: statusChange.to,
          dataPreview: (h.data ?? "").slice(0, 200),
        }),
      );
      if (statusSamples.length >= 20) break;
    }

    console.log("--- 20 samples: status change in history.data ---");
    for (const s of statusSamples) console.log(s);
    console.log("");

    const onReview = rawTasks.filter((t) => isTestingStatus(t.status));
    console.log(`Tasks currently on review/testing: ${onReview.length}`);
    let reviewFromHistory = 0;
    let reviewFallback = 0;
    for (const t of onReview.slice(0, 15)) {
      const info = findReviewStartedAt(t, resolve);
      if (!info) continue;
      if (info.confidence === "history") reviewFromHistory++;
      else reviewFallback++;
      console.log(
        [
          `boardId=${t.boardId}`,
          `taskId=${t.id}`,
          `status=${JSON.stringify(t.status)}`,
          `reviewStartedAt=${info.at}`,
          `confidence=${info.confidence}`,
        ].join(" | "),
      );
    }
    console.log("");
    console.log(
      `reviewStartedAt: history=${reviewFromHistory} fallback=${reviewFallback} (sample of ${Math.min(15, onReview.length)})`,
    );
    console.log(
      `Can determine reviewStartedAt: ${reviewFromHistory > 0 ? "YES (from history)" : onReview.length === 0 ? "N/A (no tasks on review)" : "FALLBACK ONLY"}`,
    );
    console.log("");

    let reworkCount = 0;
    const reworkSamples: string[] = [];
    for (const t of rawTasks) {
      const transitions = findReworkTransitions(t, resolve);
      if (transitions.length === 0) continue;
      reworkCount++;
      if (reworkSamples.length < 10) {
        const latest = transitions[0]!;
        reworkSamples.push(
          JSON.stringify({
            boardId: t.boardId,
            taskId: t.id,
            from: latest.fromStatus,
            to: latest.toStatus,
            at: latest.at,
            user: latest.userName ?? latest.userId,
          }),
        );
      }
    }
    console.log(`Tasks with rework transitions (review→work): ${reworkCount}`);
    for (const s of reworkSamples) console.log(s);
    console.log(
      reworkCount > 0
        ? "Can determine return-to-rework: YES"
        : "Can determine return-to-rework: NO samples — check action_type/data above",
    );
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
