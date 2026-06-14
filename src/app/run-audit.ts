import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { WebhookPublisher, DiscordPublishError } from "../adapters/discord/webhook.js";
import type { ReportArtifact } from "../adapters/discord/publisher.js";
import { loadAuditConfig } from "../config/audit-config.js";
import { loadAuditScope } from "../config/audit-scope.js";
import { loadEnv } from "../config/env.js";
import { createLogger } from "../adapters/apptask/logger.js";
import type { AuditResult } from "../rules/rule-types.js";
import { buildAuditResult } from "../reports/build-audit-result.js";
import { buildDiscordSummary } from "../reports/discord-summary.js";
import { writeAuditReports, type AuditOutputPaths } from "../reports/output.js";
import {
  isAuditDiscordDmOnly,
  publishAuditToConfiguredChannel,
} from "../discord/publish-report.js";
import type { CommentsAuditMode } from "../comments/comments-audit-config.js";
import type { EnrichCommentsResult } from "../comments/enrich-tasks-comments.js";
import { collectTasksFromBoard } from "./collect-tasks.js";
import { loadDbConfig } from "../collectors/db-config.js";
import {
  isAuditLocked,
  releaseAuditLock,
  tryAcquireAuditLock,
} from "./audit-lock.js";

const log = createLogger("audit");

export type RunAuditOptions = {
  projectName?: string;
  /** 0 = все карточки на доске */
  maxCards?: number;
  /** Переопределяет COMMENTS_AUDIT_MODE (off | candidates | all). */
  commentsAuditMode?: CommentsAuditMode;
  /** Лимит только для загрузки комментариев (Discord > env). */
  commentsAuditLimit?: number;
  /** Доска только для comments audit (если не задана — board_url). */
  commentsBoardUrl?: string;
};

export type RunAuditResult = {
  result: AuditResult;
  output: AuditOutputPaths;
  discordPublished: boolean;
  discordError?: string;
  totalOnBoard: number;
  commentsAudit?: EnrichCommentsResult;
  ignoredCount: number;
  ignoredUrls: string[];
};

/**
 * Полный прогон: collect → evaluate → save reports → Discord webhook.
 */
export async function runAudit(
  boardUrl: string,
  discordWebhookUrl?: string | null,
  options: RunAuditOptions = {},
): Promise<RunAuditResult> {
  if (isAuditLocked()) {
    throw new Error("Аудит уже выполняется, дождитесь завершения.");
  }
  if (!tryAcquireAuditLock()) {
    throw new Error("Аудит уже выполняется, дождитесь завершения.");
  }

  try {
    return await runAuditInner(boardUrl, discordWebhookUrl, options);
  } finally {
    releaseAuditLock();
  }
}

async function runAuditInner(
  boardUrl: string,
  discordWebhookUrl?: string | null,
  options: RunAuditOptions = {},
): Promise<RunAuditResult> {
  const env = loadEnv();
  const projectName = options.projectName ?? env.projectName;

  const auditScope = loadAuditScope();
  log.info(
    `[audit-command] boardUrl=${boardUrl} scope=${auditScope} limit=${options.maxCards ?? "full"} comments=${options.commentsAuditMode ?? "off"}`,
  );
  const collectResult = await collectTasksFromBoard(boardUrl, {
    maxCards: options.maxCards,
    commentsAuditMode: options.commentsAuditMode ?? "off",
    commentsAuditLimit: options.commentsAuditLimit,
    commentsBoardUrl: options.commentsBoardUrl,
    onProgress: (cur, total, title) => {
      log.info(`progress ${cur}/${total}: ${title ?? "?"}`);
    },
  });
  const {
    tasks,
    totalOnBoard,
    appTaskUsers,
    commentsAudit,
    ignoredCount,
    ignoredUrls,
    dbStats,
  } = collectResult;

  if (dbStats) {
    log.info(
      `collectorSource=db auditScope=${dbStats.auditScope} maxCardsScope=${dbStats.maxCardsScope} boardsChecked=${Object.keys(dbStats.auditedByBoard).length}`,
    );
  }

  log.info(
    `evaluate ${tasks.length} tasks (${totalOnBoard} available), users=${appTaskUsers.length}`,
  );
  if (commentsAudit && commentsAudit.mode !== "off") {
    log.info(
      `Comments audit: boardId=${commentsAudit.boardId}, mode=${commentsAudit.mode}, limit=${commentsAudit.commentsLimit ?? "none"}, checked=${commentsAudit.checkedComments}, withComments=${commentsAudit.tasksWithComments}`,
    );
  }
  const config = loadAuditConfig();
  const collectorMode =
    process.env.APPTASK_COLLECTOR?.trim().toLowerCase() || "playwright";
  const result = await buildAuditResult(
    tasks,
    config,
    {
      projectName,
      boardUrl,
    },
    appTaskUsers,
    {
      collectorSource: collectorMode,
      boardsChecked: new Set(tasks.map((t) => t.boardId).filter(Boolean)).size || 1,
      auditScope: dbStats?.auditScope ?? auditScope,
      maxCardsScope: dbStats?.maxCardsScope,
      availableByBoard: dbStats?.availableByBoard,
      appTaskBaseUrl: dbStats ? loadDbConfig().appTaskBaseUrl : undefined,
      stateNameByKey: dbStats?.stateNameByKey,
    },
  );

  log.info(`save reports (FAIL=${result.meta.failCount}, WARN=${result.meta.warnCount})`);
  const output = writeAuditReports(result, undefined, {
    ignoredCount,
    ignoredUrls,
  });

  const auditOut: RunAuditResult = {
    result,
    output,
    discordPublished: false,
    totalOnBoard,
    commentsAudit,
    ignoredCount,
    ignoredUrls,
  };

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
  } else if (isAuditDiscordDmOnly()) {
    log.info(
      "discord: skipped (AUDIT_DISCORD_DM_ONLY — use publish:audit --dm or npm run discord:bot)",
    );
  } else if (
    process.env.DISCORD_BOT_TOKEN?.trim() &&
    process.env.AUDIT_DISCORD_CHANNEL_ID?.trim()
  ) {
    try {
      await publishAuditToConfiguredChannel(auditOut);
      discordPublished = true;
      log.info(
        `discord: published to channel ${process.env.AUDIT_DISCORD_CHANNEL_ID?.trim()}`,
      );
    } catch (err) {
      discordError =
        err instanceof Error ? err.message : String(err);
      log.info(`discord: failed — ${discordError}`);
    }
  } else {
    log.info("discord: skipped (no webhook URL or bot channel config)");
  }

  return {
    ...auditOut,
    discordPublished,
    discordError,
  };
}

function parseLimitValue(raw: string | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** `--limit 3` и `--limit=3` (npm часто передаёт второй вариант). */
function readLimitFromArgv(argv: string[], index: number): { value: number | null; nextIndex: number } {
  const arg = argv[index]!;
  if (arg === "--limit" || arg === "-l") {
    return { value: parseLimitValue(argv[index + 1]), nextIndex: index + 1 };
  }
  const inline = arg.match(/^(?:--limit|-l)=(.+)$/);
  if (inline) {
    return { value: parseLimitValue(inline[1]), nextIndex: index };
  }
  return { value: null, nextIndex: index };
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
    const limit = readLimitFromArgv(argv, i);
    if (arg === "--limit" || arg === "-l" || /^(--limit|-l)=/.test(arg)) {
      if (limit.value != null) maxCards = limit.value;
      i = limit.nextIndex;
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
