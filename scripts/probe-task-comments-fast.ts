/**
 * Fast comments probe: POST get_task_comments without opening each task modal.
 *
 * Run:
 *   npx tsx scripts/probe-task-comments-fast.ts --board-url "https://apptask.ru/c/7/board/54" --mode candidates --limit 100
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { assertProfileExists, launchApptaskContext } from "../src/adapters/apptask/auth.js";
import { openBoardWithReadiness } from "../src/adapters/apptask/board.js";
import { collectTaskRefsFromBoard } from "../src/adapters/apptask/collect.js";
import { createLogger } from "../src/adapters/apptask/logger.js";
import { parseBoardId } from "../src/adapters/apptask/urls.js";
import {
  attachCommentsApiDiscovery,
  loadTaskComments,
} from "../src/comments/app-task-comments.js";
import {
  filterTasksForCommentsLoad,
  loadCommentsAuditConfig,
  shouldLoadCommentsForTask,
  type CommentsAuditMode,
} from "../src/comments/comments-audit-config.js";
import { enrichTasksWithComments } from "../src/comments/enrich-tasks-comments.js";
import { emptyRawTask, type RawTask } from "../src/adapters/apptask/types.js";

const log = createLogger("probe:comments:fast");

type CliOptions = {
  boardUrl: string;
  mode: CommentsAuditMode;
  limit: number;
};

function parseCli(argv: string[]): CliOptions {
  let boardUrl = "";
  let mode: CommentsAuditMode = "candidates";
  let limit = 100;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    switch (arg) {
      case "--board-url":
        boardUrl = next ?? "";
        i++;
        break;
      case "--mode":
        if (next === "off" || next === "candidates" || next === "all") {
          mode = next;
        }
        i++;
        break;
      case "--limit":
        limit = Number(next ?? "100");
        i++;
        break;
      default:
        break;
    }
  }

  if (!boardUrl.trim()) {
    console.error("--board-url is required");
    process.exit(1);
  }
  if (!Number.isFinite(limit) || limit < 1) limit = 100;

  return { boardUrl: boardUrl.trim(), mode, limit };
}

function refToMinimalTask(
  taskId: string,
  title: string | null,
  status: string | null,
  dueDate: string | null,
): RawTask {
  return {
    ...emptyRawTask(),
    id: taskId,
    title,
    status,
    dueDate,
  };
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  const boardId = parseBoardId(opts.boardUrl);
  if (!boardId) {
    console.error(`Invalid board URL: ${opts.boardUrl}`);
    process.exit(1);
  }

  assertProfileExists();
  const commentsConfig = loadCommentsAuditConfig({ mode: opts.mode });

  console.log("=== Fast comments probe ===\n");
  console.log(`Board: ${opts.boardUrl}`);
  console.log(`Mode: ${opts.mode}`);
  console.log(`Limit: ${opts.limit}`);

  const started = Date.now();
  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const stopDiscovery = attachCommentsApiDiscovery(page);
    await openBoardWithReadiness(page, opts.boardUrl);
    stopDiscovery();

    const refs = (await collectTaskRefsFromBoard(page)).slice(0, opts.limit);
    const tasks: RawTask[] = refs
      .filter((r) => r.taskId)
      .map((r) => refToMinimalTask(r.taskId!, r.titlePreview, null, null));

    const candidates = tasks.filter(shouldLoadCommentsForTask).length;
    const stats = await enrichTasksWithComments(page, tasks, commentsConfig);

    const found = tasks
      .filter((t) => (t.comments?.length ?? 0) > 0)
      .map((t) => ({
        taskId: t.id,
        title: t.title,
        commentsCount: t.comments.length,
      }));

    const summary = {
      boardUrl: opts.boardUrl,
      boardId,
      mode: opts.mode,
      totalTaskRefs: refs.length,
      candidates,
      checkedComments: stats.checkedComments,
      tasksWithComments: stats.tasksWithComments,
      durationMs: Date.now() - started,
      found,
    };

    const outDir = path.join("output", "debug", "comments");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `board-${boardId}-fast-comments-summary.json`);
    fs.writeFileSync(outFile, JSON.stringify(summary, null, 2), "utf8");

    console.log("\n--- Summary ---");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nSaved: ${outFile}`);

    if (opts.mode !== "off" && found.length > 0) {
      const sampleId = found[0]!.taskId;
      if (sampleId) {
        const sample = await loadTaskComments(page, sampleId);
        log.info(`sample task ${sampleId}: ${sample.length} comments via API`);
      }
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
