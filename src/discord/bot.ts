import "dotenv/config";
import path from "node:path";
import {
  ApplicationCommandOptionType,
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import { runAudit, type RunAuditResult } from "../app/run-audit.js";
import {
  addProject,
  loadProjects,
  removeProject,
} from "../config/projects.js";
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

const slashCommands = [
  {
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
  },
  {
    name: "project_add",
    description: "Save AppTask board → Discord channel mapping",
    options: [
      {
        name: "name",
        description: "Project name",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "board_url",
        description: "AppTask board URL",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "channel",
        description: "Discord channel for audit reports",
        type: ApplicationCommandOptionType.Channel,
        required: true,
        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      },
    ],
  },
  {
    name: "project_list",
    description: "List saved board → channel mappings",
  },
  {
    name: "project_remove",
    description: "Remove a saved project mapping",
    options: [
      {
        name: "name",
        description: "Project name or id",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
] as const;

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

async function handleAuditCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  console.log("audit command received");

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
}

async function handleProjectAdd(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const name = interaction.options.getString("name", true).trim();
  const boardUrl = resolveBoardUrl(
    interaction.options.getString("board_url", true),
  );
  const channel = interaction.options.getChannel("channel", true);

  if (!boardUrl) {
    await interaction.editReply(
      "Укажите корректный `board_url` (только https://…).",
    );
    return;
  }

  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    await interaction.editReply("Канал должен быть текстовым каналом сервера.");
    return;
  }

  const project = addProject({
    name,
    boardUrl,
    discordChannelId: channel.id,
  });

  await interaction.editReply(
    [
      "Проект сохранён:",
      project.name,
      project.boardUrl,
      project.discordChannelId,
    ].join("\n"),
  );
}

async function handleProjectList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const projects = loadProjects();

  if (projects.length === 0) {
    await interaction.editReply("Проекты пока не настроены.");
    return;
  }

  const lines = projects.flatMap((p) => [
    `**${p.name}** (\`${p.id}\`)`,
    p.boardUrl,
    p.discordChannelId,
    `enabled: ${p.enabled}`,
    "",
  ]);

  const text = lines.join("\n").trim();
  await interaction.editReply(
    text.length > 2000 ? `${text.slice(0, 1980)}…` : text,
  );
}

async function handleProjectRemove(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const nameOrId = interaction.options.getString("name", true);
  const removed = removeProject(nameOrId);

  if (!removed) {
    await interaction.editReply(
      `Проект не найден: \`${nameOrId}\` (укажите name или id).`,
    );
    return;
  }

  await interaction.editReply(
    `Проект удалён: **${removed.name}** (\`${removed.id}\`).`,
  );
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
      body: slashCommands,
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
      body: slashCommands,
    });
    console.log(`Slash commands registered for guild: ${guild.name} (${guild.id})`);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const ephemeral = MessageFlags.Ephemeral;

  if (
    interaction.commandName === "project_add" ||
    interaction.commandName === "project_list" ||
    interaction.commandName === "project_remove"
  ) {
    try {
      await interaction.deferReply({ flags: ephemeral });
    } catch (err) {
      console.error("deferReply failed:", err);
      return;
    }

    try {
      if (interaction.commandName === "project_add") {
        await handleProjectAdd(interaction);
      } else if (interaction.commandName === "project_list") {
        await handleProjectList(interaction);
      } else {
        await handleProjectRemove(interaction);
      }
    } catch (err) {
      console.error(`${interaction.commandName} failed:`, err);
      try {
        await interaction.editReply("❌ Ошибка. См. логи бота в консоли.");
      } catch {
        // ignore
      }
    }
    return;
  }

  if (interaction.commandName !== "audit") return;

  try {
    await interaction.deferReply({ flags: ephemeral });
  } catch (err) {
    console.error("deferReply failed (interaction expired or duplicate):", err);
    return;
  }

  await handleAuditCommand(interaction);
});

await client.login(token);
