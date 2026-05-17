import "dotenv/config";
import path from "node:path";
import {
  ApplicationCommandOptionType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import { runAudit, type RunAuditResult } from "../app/run-audit.js";
import {
  buildReportAttachments,
  formatAuditReply,
  formatBriefSummary,
} from "./publish-report.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is not set in .env");
  process.exit(1);
}

const auditChannelId = process.env.AUDIT_DISCORD_CHANNEL_ID?.trim() || null;

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const auditCommand = {
  name: "audit",
  description: "Run AppTask audit",
  options: [
    {
      name: "board_url",
      description: "AppTask board URL",
      type: ApplicationCommandOptionType.String,
      required: false,
    },
    {
      name: "limit",
      description: "Limit number of cards for audit",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      min_value: 1,
      max_value: 100,
    },
  ],
} as const;

/** Из опции Discord или .env; если вставили всю команду — вытащить https://… */
function resolveBoardUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(/https?:\/\/[^\s]+/i);
  if (match) return match[0]!.replace(/[>,)\]]+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

/** Полный отчёт только для вызвавшего пользователя (ephemeral followUp). */
async function deliverEphemeralReport(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
): Promise<void> {
  const content = formatAuditReply(out);
  const files = buildReportAttachments(out);
  const outputDir = path.resolve(out.output.dir);
  const ephemeral = MessageFlags.Ephemeral;

  try {
    await interaction.followUp({ content, flags: ephemeral });
  } catch (err) {
    console.error("ephemeral followUp (summary) failed:", err);
    try {
      await interaction.followUp({
        content: `Локальный отчёт: \`${outputDir}\``,
        flags: ephemeral,
      });
    } catch (fallbackErr) {
      console.error("ephemeral followUp (path fallback) failed:", fallbackErr);
    }
    return;
  }

  if (files.length === 0) {
    console.warn("No report files found for Discord attachments");
    return;
  }

  try {
    await interaction.followUp({
      content: "📎 Report files",
      files,
      flags: ephemeral,
    });
    console.log(`[attachments] sent via ephemeral followUp (${files.length} files)`);
  } catch (err) {
    console.error("ephemeral followUp with attachments failed:", err);
    try {
      await interaction.followUp({
        content: `Не удалось отправить файлы в Discord. Локальный отчёт:\n\`${outputDir}\``,
        flags: ephemeral,
      });
    } catch (fallbackErr) {
      console.error("ephemeral followUp (files path fallback) failed:", fallbackErr);
    }
  }
}

async function replyWithAuditResult(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
): Promise<void> {
  const brief = formatBriefSummary(out);

  await interaction.editReply({
    content: `✅ **Audit completed.**\n\n${brief}`,
  });

  await deliverEphemeralReport(interaction, out);
}

client.once("clientReady", async (readyClient) => {
  console.log(`Discord bot logged in as ${readyClient.user.tag}`);
  if (auditChannelId) {
    console.log(
      `[audit-channel] configured for scheduled runs only: ${auditChannelId}`,
    );
  }

  const rest = new REST().setToken(token);
  const guildId = process.env.DISCORD_GUILD_ID?.trim();

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guildId), {
      body: [auditCommand],
    });
    console.log(`Slash commands registered for guild ${guildId}`);
    return;
  }

  if (readyClient.guilds.cache.size === 0) {
    console.warn(
      "Bot is not on any server — invite it, then restart. Slash commands were not registered.",
    );
    return;
  }

  for (const guild of readyClient.guilds.cache.values()) {
    await rest.put(Routes.applicationGuildCommands(readyClient.user.id, guild.id), {
      body: [auditCommand],
    });
    console.log(`Slash commands registered for guild: ${guild.name} (${guild.id})`);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "audit") return;

  console.log("audit command received");
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error("deferReply failed (interaction expired or duplicate):", err);
    return;
  }

  const boardUrl =
    resolveBoardUrl(interaction.options.getString("board_url") ?? undefined) ||
    resolveBoardUrl(process.env.APPTASK_BOARD_URL);

  if (!boardUrl) {
    await interaction.editReply(
      "Укажите URL доски: опция `board_url` (только https://…) или `APPTASK_BOARD_URL` в .env.",
    );
    return;
  }

  const limit = interaction.options.getInteger("limit");
  const envMaxCards = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");
  const maxCards = limit ?? (envMaxCards > 0 ? envMaxCards : undefined);

  await interaction.editReply("⏳ **Audit started.** Сбор карточек и проверка правил…");

  try {
    console.log(
      `audit started: ${boardUrl}${maxCards != null ? ` (limit=${maxCards})` : ""}`,
    );
    const out = await runAudit(boardUrl, null, { maxCards });
    console.log(
      `audit done: cards=${out.result.meta.cardsChecked} FAIL=${out.result.meta.failCount} WARN=${out.result.meta.warnCount}`,
    );
    await replyWithAuditResult(interaction, out);
  } catch (err) {
    console.error("audit failed:", err);
    try {
      await interaction.editReply("❌ **Audit failed.** Check bot console logs.");
    } catch (editErr) {
      console.error("failed to editReply after audit error:", editErr);
    }
  }
});

await client.login(token);
