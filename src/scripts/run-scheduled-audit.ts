import "dotenv/config";
import path from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import { runAudit } from "../app/run-audit.js";
import {
  publishFullReportToChannel,
  resolveAuditChannel,
} from "../discord/publish-report.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set in .env`);
    process.exit(1);
  }
  return value;
}

async function waitForClientReady(client: Client): Promise<void> {
  if (client.isReady()) return;
  await new Promise<void>((resolve, reject) => {
    client.once("clientReady", () => resolve());
    client.once("error", reject);
  });
}

async function main(): Promise<void> {
  console.log("scheduled audit started");

  const boardUrl = requireEnv("APPTASK_BOARD_URL");
  const channelId = requireEnv("AUDIT_DISCORD_CHANNEL_ID");
  const token = requireEnv("DISCORD_BOT_TOKEN");

  console.log("board url:", boardUrl);
  console.log("audit channel id:", channelId);

  const maxCards = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(token);
    await waitForClientReady(client);

    const out = await runAudit(boardUrl, null, {
      maxCards: maxCards > 0 ? maxCards : undefined,
    });

    console.log("output dir:", path.resolve(out.output.dir));
    console.log(
      `audit stats: cards=${out.result.meta.cardsChecked} FAIL=${out.result.meta.failCount} WARN=${out.result.meta.warnCount}`,
    );

    const channel = await resolveAuditChannel(client, channelId);
    if (!channel) {
      throw new Error(`Cannot publish to audit channel ${channelId}`);
    }

    const sentFiles = await publishFullReportToChannel(channel, out, channelId);
    console.log(
      sentFiles.length > 0
        ? `files sent: ${sentFiles.join(", ")}`
        : "files sent: (none — report files missing)",
    );

    console.log("scheduled audit completed");
    await client.destroy();
    process.exit(0);
  } catch (err) {
    console.error("scheduled audit failed:", err);
    try {
      await client.destroy();
    } catch {
      // ignore cleanup errors
    }
    process.exit(1);
  }
}

void main();
