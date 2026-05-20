import "dotenv/config";
import path from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import { runAudit } from "../app/run-audit.js";
import { getEnabledProjects } from "../config/projects.js";
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

  const projects = getEnabledProjects();
  if (projects.length === 0) {
    console.error(
      "No projects configured: add via /project_add, config/projects.json, or set APPTASK_BOARD_URL and AUDIT_DISCORD_CHANNEL_ID in .env",
    );
    process.exit(1);
  }

  const token = requireEnv("DISCORD_BOT_TOKEN");
  const maxCards = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  let failed = 0;

  try {
    await client.login(token);
    await waitForClientReady(client);

    for (const project of projects) {
      console.log("[audit]");
      console.log(`project=${project.name}`);
      console.log(`board=${project.boardUrl}`);
      console.log(`channel=${project.discordChannelId}`);

      try {
        const out = await runAudit(project.boardUrl, null, {
          maxCards: maxCards > 0 ? maxCards : undefined,
          projectName: project.name,
        });

        console.log("output dir:", path.resolve(out.output.dir));
        console.log(
          `audit stats: cards=${out.result.meta.cardsChecked} FAIL=${out.result.meta.failCount} WARN=${out.result.meta.warnCount}`,
        );

        const channel = await resolveAuditChannel(
          client,
          project.discordChannelId,
        );
        if (!channel) {
          throw new Error(
            `Cannot publish to audit channel ${project.discordChannelId}`,
          );
        }

        const sentFiles = await publishFullReportToChannel(
          channel,
          out,
          project.discordChannelId,
        );
        console.log(
          sentFiles.length > 0
            ? `files sent: ${sentFiles.join(", ")}`
            : "files sent: (none — report files missing)",
        );
      } catch (err) {
        failed += 1;
        console.error(
          `scheduled audit failed for project ${project.name} (${project.id}):`,
          err,
        );
      }
    }

    await client.destroy();

    if (failed > 0) {
      console.error(
        `scheduled audit completed with ${failed} failure(s) of ${projects.length} project(s)`,
      );
      process.exit(1);
    }

    console.log(
      `scheduled audit completed (${projects.length} project(s))`,
    );
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
