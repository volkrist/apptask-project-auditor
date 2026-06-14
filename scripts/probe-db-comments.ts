import "dotenv/config";
import { loadDbConfig, parseBoardIds } from "../src/collectors/db-config.js";
import { closeDb } from "../src/collectors/db-client.js";
import {
  fetchActiveTasks,
  fetchComments,
} from "../src/collectors/db-queries.js";
import { mapDbBundleToRawTasks } from "../src/collectors/db-mapper.js";
import {
  collectCommentIssues,
  COMMENT_AUDIT_RULE_IDS,
} from "../src/reports/comment-issues.js";
import { loadAuditConfig } from "../src/config/audit-config.js";
import { evaluateProject } from "../src/rules/evaluate.js";
import fs from "node:fs";
import path from "node:path";

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
  const auditJsonPath = process.argv.find((a) => a.endsWith("audit.json"));
  const fromArgv = parseArgs(process.argv.slice(2));
  const boardIds =
    fromArgv.length > 0 ? fromArgv : parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);
  const config = loadDbConfig({ boardIds });
  const sampleSize = Number(process.env.PROBE_COMMENT_SAMPLES ?? "5");

  console.log("=== DB Comments Probe (read-only SELECT) ===");
  console.log(`Board IDs: ${boardIds.join(", ") || "(none)"}`);
  console.log(
    `Comment rules in main audit: ${[...COMMENT_AUDIT_RULE_IDS].join(", ")}`,
  );
  console.log(
    "Separate flow: /comments_* + COMMENT_QUESTION_MARKERS (Playwright/API, not auto in DB audit)",
  );
  console.log("");

  try {
    const [tasks, comments] = await Promise.all([
      fetchActiveTasks(config, boardIds),
      fetchComments(config, boardIds),
    ]);

    console.log(`SQL comments rows: ${comments.length}`);
    const rawTasks = mapDbBundleToRawTasks(
      { tasks, assignees: [], tags: [], comments, histories: [] },
      config.appTaskBaseUrl,
    );
    const withComments = rawTasks.filter((t) => t.comments.length > 0);
    console.log(
      `Tasks with RawTask.comments: ${withComments.length} / ${rawTasks.length}`,
    );
    console.log("");

    const samples = [...withComments]
      .sort((a, b) => b.comments.length - a.comments.length)
      .slice(0, sampleSize);

    console.log(`--- Sample tasks (top ${samples.length} by comment count) ---`);
    for (const t of samples) {
      const first = t.comments[0];
      console.log(
        [
          `boardId=${t.boardId}`,
          `taskId=${t.id}`,
          `title=${JSON.stringify((t.title ?? "").slice(0, 60))}`,
          `comments.length=${t.comments.length}`,
          `first.text=${JSON.stringify((first?.text ?? "").slice(0, 100))}`,
          `first.author=${first?.creatorName ?? first?.creatorId ?? "—"}`,
        ].join(" | "),
      );
    }
    console.log("");

    if (auditJsonPath && fs.existsSync(auditJsonPath)) {
      const result = JSON.parse(fs.readFileSync(auditJsonPath, "utf8"));
      const issues = collectCommentIssues(result);
      console.log(`--- From audit.json: ${auditJsonPath} ---`);
      console.log(`Comment issue rows for report section: ${issues.length}`);
      for (const row of issues.slice(0, 10)) {
        console.log(
          `  board ${row.boardId} #${row.taskId} | ${row.ruleId} | marker=${row.marker} | author=${row.commentAuthor}`,
        );
      }
      if (issues.length > 10) {
        console.log(`  ... and ${issues.length - 10} more`);
      }
      return;
    }

    const limited = rawTasks.slice(0, 30);
    const ruleConfig = loadAuditConfig();
    const evaluated = await evaluateProject(limited, ruleConfig, []);
    let hits = 0;
    for (const card of evaluated.cards) {
      for (const r of card.results) {
        if (r.status !== "PASS" && COMMENT_AUDIT_RULE_IDS.has(r.ruleId)) {
          hits++;
          console.log(
            `rule hit (sample 30 tasks): ${r.ruleId} on board ${card.task.boardId} #${card.task.id} — ${r.reason.slice(0, 80)}`,
          );
        }
      }
    }
    if (hits === 0) {
      console.log(
        "No comment-rule hits in first 30 mapped tasks (pass audit.json path to analyze full run).",
      );
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
