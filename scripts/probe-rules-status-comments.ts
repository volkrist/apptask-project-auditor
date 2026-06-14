import "dotenv/config";
import { loadDbConfig, parseBoardIds } from "../src/collectors/db-config.js";
import { closeDb } from "../src/collectors/db-client.js";
import {
  fetchActiveTasks,
  fetchAssignees,
  fetchComments,
  fetchHistories,
  fetchBoardStates,
  fetchTags,
} from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import { buildStateNameByKey } from "../src/collectors/state-map.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { evaluateProject } from "../src/rules/evaluate.js";
import { buildBoardAuditMetrics } from "../src/reports/board-metrics.js";
import { computeIssueCounts } from "../src/reports/structured-findings.js";
import {
  COMMENT_STATUS_RULE_IDS,
  STALE_STATUS_RULE_IDS,
  TESTING_QUEUE_RULE_IDS,
} from "../src/rules/soft/status-comment-rules.js";

function parseArgs(argv: string[]): { boardIds: number[]; limit: number } {
  let limit = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "50") || 50;
  const boardIds: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--board-ids" && argv[i + 1]) {
      boardIds.push(...parseBoardIds(argv[++i]));
    } else if (a.startsWith("--board-ids=")) {
      boardIds.push(...parseBoardIds(a.slice("--board-ids=".length)));
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Number(argv[++i]) || limit;
    } else if (a.startsWith("--limit=")) {
      limit = Number(a.slice("--limit=".length)) || limit;
    }
  }
  return { boardIds, limit };
}

function countRule(cards: Awaited<ReturnType<typeof evaluateProject>>["cards"], ruleId: string): number {
  return cards.filter((c) =>
    c.results.some((r) => r.ruleId === ruleId && r.status !== "PASS"),
  ).length;
}

function samples(
  cards: Awaited<ReturnType<typeof evaluateProject>>["cards"],
  ruleId: string,
  n = 5,
): void {
  let shown = 0;
  for (const card of cards) {
    const rule = card.results.find(
      (r) => r.ruleId === ruleId && r.status !== "PASS",
    );
    if (!rule) continue;
    const t = card.task;
    console.log(
      `  - board=${t.boardId} task=${t.id} status=${JSON.stringify(t.status)} | ${rule.status}: ${rule.reason.slice(0, 120)}`,
    );
    shown++;
    if (shown >= n) break;
  }
}

async function main(): Promise<void> {
  const { boardIds: fromArgv, limit } = parseArgs(process.argv.slice(2));
  const boardIds =
    fromArgv.length > 0 ? fromArgv : parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);
  const config = loadDbConfig({ boardIds });
  const auditConfig = loadAuditConfig();

  console.log("=== Rules Probe: status + comments (read-only SELECT) ===");
  console.log(`Board IDs: ${boardIds.join(", ")} | limit=${limit}`);
  console.log("");

  try {
    const [tasks, assignees, tags, comments, histories, boardStates] =
      await Promise.all([
      fetchActiveTasks(config, boardIds),
      fetchAssignees(config, boardIds),
      fetchTags(config, boardIds),
      fetchComments(config, boardIds),
      fetchHistories(config, boardIds),
      fetchBoardStates(config, boardIds),
    ]);

    const stateNameByKey = buildStateNameByKey(boardStates);

    let rawTasks = mapDbBundleToRawTasks(
      { tasks, assignees, tags, comments, histories },
      config.appTaskBaseUrl,
    );
    if (limit > 0 && rawTasks.length > limit) {
      rawTasks = rawTasks.slice(0, limit);
    }

    const boardMetrics = buildBoardAuditMetrics(rawTasks);
    const project = await evaluateProject(rawTasks, auditConfig, undefined, {
      boardMetrics,
      stateNameByKey,
    });
    const counts = computeIssueCounts(project.cards, boardMetrics);

    console.log("--- Issue counts ---");
    console.log(`deadlineIssues: ${counts.deadlineIssues}`);
    console.log(`staleInProgressIssues: ${counts.staleInProgressIssues}`);
    console.log(`staleReviewIssues: ${counts.staleReviewIssues}`);
    console.log(`testingQueueIssues (boards): ${counts.testingQueueIssues}`);
    console.log(`criticalNoMovementIssues: ${counts.criticalNoMovementIssues}`);
    console.log(`commentIssues: ${counts.commentIssues}`);
    console.log("");

    console.log("--- Per-rule counts ---");
    for (const id of [
      "deadline_less_than_one_day",
      "in_progress_stale",
      "review_stale",
      "review_queue_over_limit",
      "high_priority_stale",
      "blocked_task_reason",
      "vague_done_comment",
      "rework_without_reason",
      ...COMMENT_STATUS_RULE_IDS,
    ]) {
      console.log(`  ${id}: ${countRule(project.cards, id)}`);
    }
    console.log("");

    const sections: Array<[string, string]> = [
      ["deadline_less_than_one_day", "Deadline < 1d / overdue"],
      ["in_progress_stale", "Stale in progress"],
      ["review_stale", "Stale on review"],
      ["review_queue_over_limit", "Testing queue > limit"],
      ["high_priority_stale", "Critical/high no movement"],
      ["blocked_task_reason", "Blocked without reason"],
      ["vague_done_comment", "Vague done comments"],
      ["rework_without_reason", "Rework without reason"],
    ];

    for (const [ruleId, title] of sections) {
      console.log(`--- Samples: ${title} ---`);
      samples(project.cards, ruleId, 5);
      console.log("");
    }

    console.log("--- Board testing queues ---");
    for (const board of Object.values(boardMetrics.byBoard)) {
      if (board.testingQueueCount <= board.testingQueueMax) continue;
      console.log(
        `  board ${board.boardId}: ${board.testingQueueCount} (max ${board.testingQueueMax})`,
      );
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
