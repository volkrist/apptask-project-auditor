/**
 * Повторная публикация готового отчёта в Discord (без повторного аудита).
 *
 * npm run publish:audit -- output/audit-2026-05-26-16-16-02
 * npm run publish:audit -- --dm output/audit-2026-05-26-16-16-02
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import type { RunAuditResult } from "../app/run-audit.js";
import type { AuditOutputPaths } from "../reports/output.js";
import type { AuditResult } from "../rules/rule-types.js";
import {
  publishFullReportToChannel,
  resolveAuditChannel,
  resolveAuditDmUser,
} from "../discord/publish-report.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}

function isDmOnlyFlag(argv: string[]): boolean {
  if (argv.includes("--dm")) return true;
  const v = process.env.AUDIT_DISCORD_DM_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dmOnly = isDmOnlyFlag(argv);
  const auditDirArg = argv.find((a) => !a.startsWith("--"));
  const auditDir = path.resolve(auditDirArg ?? "");
  if (!auditDir || !fs.existsSync(auditDir)) {
    console.error(
      "Usage: npm run publish:audit -- [--dm] <output/audit-YYYY-MM-DD-HH-MM-SS>",
    );
    process.exit(1);
  }

  const jsonPath = path.join(auditDir, "audit.json");
  const markdownPath = path.join(auditDir, "audit.md");
  const summaryPath = path.join(auditDir, "summary.md");
  const reportPath = path.join(auditDir, "audit-report.md");
  for (const p of [jsonPath, markdownPath, summaryPath, reportPath]) {
    if (!fs.existsSync(p)) {
      console.error(`Missing file: ${p}`);
      process.exit(1);
    }
  }

  const result = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as AuditResult;
  const output: AuditOutputPaths = {
    dir: auditDir,
    jsonPath,
    markdownPath,
    summaryPath,
    reportPath,
  };

  const out: RunAuditResult = {
    result,
    output,
    discordPublished: false,
    totalOnBoard: result.meta.cardsChecked,
    ignoredCount: 0,
    ignoredUrls: [],
  };

  const token = requireEnv("DISCORD_BOT_TOKEN");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  await client.login(token);
  await new Promise<void>((resolve, reject) => {
    if (client.isReady()) resolve();
    else {
      client.once("clientReady", () => resolve());
      client.once("error", reject);
    }
  });

  const header = [
    "📢 **Повторная публикация отчёта аудита**",
    `Проверено **${result.meta.cardsChecked}** карточек | FAIL: **${result.meta.failCount}** | WARN: **${result.meta.warnCount}**`,
    `Доска: ${result.meta.boardUrl}`,
    "",
  ].join("\n");

  if (dmOnly) {
    const userId = requireEnv("AUDIT_DISCORD_DM_USER_ID");
    const user = await resolveAuditDmUser(client, { userId });
    if (!user) {
      console.error("Cannot resolve DM recipient");
      process.exit(1);
    }
    const dm = await user.createDM();
    await dm.send({ content: header });
    const sent = await publishFullReportToChannel(dm, out, user.id);
    console.log(`Published to DM user ${user.tag} (${user.id}): ${sent.join(", ")}`);
  } else {
    const channelId = requireEnv("AUDIT_DISCORD_CHANNEL_ID");
    const channel = await resolveAuditChannel(client, channelId);
    if (!channel) {
      console.error(`Cannot publish to channel ${channelId}`);
      process.exit(1);
    }
    await channel.send({ content: header });
    const sent = await publishFullReportToChannel(channel, out, channelId);
    console.log(`Published to channel ${channelId}: ${sent.join(", ")}`);
  }

  await client.destroy();
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
