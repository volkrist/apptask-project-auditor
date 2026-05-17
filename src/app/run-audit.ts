import fs from "node:fs";
import path from "node:path";
import { WebhookPublisher, DiscordPublishError } from "../adapters/discord/webhook.js";
import type { ReportArtifact } from "../adapters/discord/publisher.js";
import { loadAuditConfig } from "../config/audit-config.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../adapters/apptask/logger.js";
import type { AuditResult } from "../rules/rule-types.js";
import { buildAuditResult } from "../reports/build-audit-result.js";
import { buildDiscordSummary } from "../reports/discord-summary.js";
import { writeAuditReports, type AuditOutputPaths } from "../reports/output.js";
import { collectTasksFromBoard } from "./collect-tasks.js";

const log = createLogger("audit");

export type RunAuditOptions = {
  projectName?: string;
  /** 0 = все карточки на доске */
  maxCards?: number;
};

export type RunAuditResult = {
  result: AuditResult;
  output: AuditOutputPaths;
  discordPublished: boolean;
  discordError?: string;
  totalOnBoard: number;
};

/**
 * Полный прогон: collect → evaluate → save reports → Discord webhook.
 */
export async function runAudit(
  boardUrl: string,
  discordWebhookUrl?: string | null,
  options: RunAuditOptions = {},
): Promise<RunAuditResult> {
  const env = loadEnv();
  const projectName = options.projectName ?? env.projectName;

  log.info(`collect board: ${boardUrl}`);
  const { tasks, totalOnBoard } = await collectTasksFromBoard(boardUrl, {
    maxCards: options.maxCards,
    onProgress: (cur, total, title) => {
      log.info(`progress ${cur}/${total}: ${title ?? "?"}`);
    },
  });

  log.info(`evaluate ${tasks.length} tasks (${totalOnBoard} on board)`);
  const config = loadAuditConfig();
  const result = await buildAuditResult(tasks, config, {
    projectName,
    boardUrl,
  });

  log.info(`save reports (FAIL=${result.meta.failCount}, WARN=${result.meta.warnCount})`);
  const output = writeAuditReports(result);

  let discordPublished = false;
  let discordError: string | undefined;

  const webhook = discordWebhookUrl?.trim();
  if (webhook) {
    try {
      const summaryText = buildDiscordSummary(result);
      const jsonBuffer = fs.readFileSync(output.jsonPath);
      const artifacts: ReportArtifact[] = [
        {
          filename: "audit.json",
          content: jsonBuffer,
          mimeType: "application/json",
        },
      ];
      await new WebhookPublisher(webhook).publish(
        { text: summaryText },
        artifacts,
      );
      discordPublished = true;
      log.info("discord: published summary + audit.json");
    } catch (err) {
      discordError =
        err instanceof DiscordPublishError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      log.info(`discord: failed — ${discordError}`);
    }
  } else {
    log.info("discord: skipped (no webhook URL)");
  }

  return { result, output, discordPublished, discordError, totalOnBoard };
}

function parseCliArgs(): {
  boardUrl: string;
  webhook: string | null;
  maxCards: number;
} {
  const env = loadEnv();
  const argv = process.argv.slice(2);
  let boardUrl = env.boardUrl;
  let webhook: string | null = env.discordWebhookUrl;
  let maxCards = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && argv[i + 1]) {
      maxCards = Number(argv[++i]);
      continue;
    }
    if (!arg.startsWith("-")) {
      if (!boardUrl || boardUrl === env.boardUrl) {
        boardUrl = arg;
      } else if (!webhook) {
        webhook = arg;
      }
    }
  }

  return { boardUrl, webhook, maxCards };
}

const isMain =
  process.argv[1]?.replace(/\\/g, "/").includes("run-audit") ?? false;

if (isMain) {
  const { boardUrl, webhook, maxCards } = parseCliArgs();
  runAudit(boardUrl, webhook, { maxCards: maxCards || undefined })
    .then((out) => {
      console.log(`\nОтчёт: ${path.resolve(out.output.dir)}`);
      console.log(
        `FAIL=${out.result.meta.failCount} WARN=${out.result.meta.warnCount}`,
      );
      if (out.discordPublished) {
        console.log("Discord: отправлено");
      } else if (out.discordError) {
        console.warn(`Discord: ошибка — ${out.discordError}`);
      }
      process.exit(out.discordError && !out.discordPublished && webhook ? 2 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
