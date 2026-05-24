import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertProfileExists,
  launchApptaskContext,
} from "../src/adapters/apptask/auth.js";
import {
  collectTasksViaApiOnPage,
  type ApiCollectorStats,
} from "../src/collectors/api-collector.js";
import type { RawTask } from "../src/adapters/apptask/types.js";

function parseArgs(argv: string[]): {
  boardUrl: string;
  limit: number;
} {
  let boardUrl = process.env.APPTASK_BOARD_URL?.trim() ?? "";
  let limit = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--board-url" && argv[i + 1]) {
      boardUrl = argv[++i]!;
    } else if (a.startsWith("--board-url=")) {
      boardUrl = a.slice("--board-url=".length);
    } else if (a === "--limit" && argv[i + 1]) {
      limit = Number(argv[++i]);
    } else if (a.startsWith("--limit=")) {
      limit = Number(a.slice("--limit=".length));
    }
  }
  if (!boardUrl) {
    throw new Error(
      'Usage: npx tsx scripts/probe-api-collector.ts --board-url "https://apptask.ru/c/7/board/54" [--limit 20]',
    );
  }
  return { boardUrl, limit: Number.isFinite(limit) && limit > 0 ? limit : 0 };
}

function collectMissingFields(tasks: RawTask[]): string[] {
  const missing = new Set<string>();
  for (const t of tasks) {
    if (!t.id) missing.add("id");
    if (!t.title) missing.add("title");
    if (!t.status) missing.add("status");
    if (!t.dueDate) missing.add("dueDate");
    if (!t.descriptionText) missing.add("descriptionText");
    if (t.assignees.length === 0) missing.add("assignees");
    if (!t.creator) missing.add("creator");
  }
  return [...missing];
}

async function main(): Promise<void> {
  const { boardUrl, limit } = parseArgs(process.argv.slice(2));
  process.env.APPTASK_COLLECTOR = "api";

  assertProfileExists();
  const outDir = path.resolve("output/debug/api-collector");
  await fs.mkdir(outDir, { recursive: true });

  const context = await launchApptaskContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const started = Date.now();
    const result = await collectTasksViaApiOnPage(page, boardUrl, {
      maxCards: limit > 0 ? limit : undefined,
    }, []);
    const stats: ApiCollectorStats = result.stats;

    const samplePath = path.join(outDir, "raw-tasks-sample.json");
    await fs.writeFile(samplePath, JSON.stringify(result.tasks, null, 2), "utf8");

    const summary = {
      boardUrl,
      collector: "api",
      tasksCollected: result.tasks.length,
      totalOnBoard: result.totalOnBoard,
      usersLoaded: result.appTaskUsers.length,
      detailsLoaded: stats.detailsLoaded,
      commentsLoaded: stats.commentsLoaded,
      durationMs: Date.now() - started,
      missingFields: collectMissingFields(result.tasks),
      warnings: stats.warnings,
      stats,
    };

    const summaryPath = path.join(outDir, "summary.json");
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nWrote ${samplePath}`);
    console.log(`Wrote ${summaryPath}`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
