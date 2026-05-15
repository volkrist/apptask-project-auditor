import { loadEnv } from "../config/env.js";
import { auditConfig } from "../config/audit-config.js";
import { PlaywrightBoardProvider } from "../adapters/apptask/board.js";
import { evaluateBoard } from "../rules/evaluate.js";
import { buildTopIssues } from "../reports/build-audit-result.js";
import { buildDetailJson } from "../reports/json.js";
import { buildDetailMarkdown } from "../reports/markdown.js";
import { buildDiscordSummary } from "../reports/discord-summary.js";

export type RunAuditOptions = {
  boardUrl?: string;
  projectName?: string;
};

/**
 * Pipeline: collect → evaluate → format → publish.
 * Implementation stubs throw until adapters are ready.
 */
export async function runAudit(options: RunAuditOptions = {}): Promise<void> {
  const env = loadEnv();
  const boardUrl = options.boardUrl ?? env.boardUrl;
  const projectName = options.projectName ?? env.projectName;

  const board = new PlaywrightBoardProvider();
  const tasks = await board.loadCards(boardUrl);

  let result = evaluateBoard(tasks, auditConfig, {
    projectName,
    boardUrl,
    auditedAt: new Date().toISOString(),
    cardsChecked: 0,
    failCount: 0,
    warnCount: 0,
  });

  result = { ...result, topIssues: buildTopIssues(result) };

  buildDetailJson(result);
  buildDetailMarkdown(result);
  buildDiscordSummary(result);

  // Discord publish wired in a later step
}

const isMain = process.argv[1]?.endsWith("run-audit.ts");
if (isMain) {
  runAudit().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
