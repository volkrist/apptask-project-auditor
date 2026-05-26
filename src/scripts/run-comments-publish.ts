/**
 * Полная проверка комментариев + публикация в Discord-канал (как /comments_full + scheduled).
 *
 * npm run comments:publish
 */
import "dotenv/config";
import path from "node:path";
import { Client, GatewayIntentBits } from "discord.js";
import { runCommentsCheck } from "../app/run-comments-check.js";
import { getEnabledProjects } from "../config/projects.js";
import { resolveCommentsBoardUrl } from "../discord/resolve-board-url.js";
import { publishFullCommentsReportToChannel } from "../discord/publish-comments.js";
import { resolveAuditChannel } from "../discord/publish-report.js";

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
  const commentsBoardUrl = resolveCommentsBoardUrl(
    process.env.APPTASK_COMMENTS_BOARD_URL,
  );
  if (!commentsBoardUrl) {
    console.error("APPTASK_COMMENTS_BOARD_URL is not set in .env");
    process.exit(1);
  }

  const projects = getEnabledProjects();
  const publishChannelId =
    process.env.AUDIT_DISCORD_CHANNEL_ID?.trim() ||
    projects[0]?.discordChannelId;
  if (!publishChannelId) {
    console.error(
      "Set AUDIT_DISCORD_CHANNEL_ID in .env or add a project with discordChannelId",
    );
    process.exit(1);
  }

  const token = requireEnv("DISCORD_BOT_TOKEN");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  console.log("[comments-publish] full comments check started");
  console.log(`board=${commentsBoardUrl}`);
  console.log(`channel=${publishChannelId}`);

  try {
    const commentsOut = await runCommentsCheck(commentsBoardUrl, {});
    console.log("output dir:", path.resolve(commentsOut.output.dir));
    console.log(
      `stats: checked=${commentsOut.checkedTasks} withComments=${commentsOut.tasksWithComments} markers=${commentsOut.markerHits.length}`,
    );

    await client.login(token);
    await waitForClientReady(client);

    const channel = await resolveAuditChannel(client, publishChannelId);
    if (!channel) {
      throw new Error(`Cannot publish to channel ${publishChannelId}`);
    }

    const sentFiles = await publishFullCommentsReportToChannel(
      channel,
      commentsOut,
      publishChannelId,
    );
    console.log(
      sentFiles.length > 0
        ? `files sent: ${sentFiles.join(", ")}`
        : "files sent: (none)",
    );

    await client.destroy();
    console.log("[comments-publish] completed");
    process.exit(0);
  } catch (err) {
    console.error("[comments-publish] failed:", err);
    try {
      await client.destroy();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

void main();
