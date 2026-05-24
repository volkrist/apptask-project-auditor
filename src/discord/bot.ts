import "dotenv/config";
import { acquireBotInstanceLock } from "./bot-lock.js";
import path from "node:path";

acquireBotInstanceLock();
import {
  ApplicationCommandOptionType,
  type AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import { runAudit, type RunAuditResult } from "../app/run-audit.js";
import type { CommentsAuditMode } from "../comments/comments-audit-config.js";
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
      {
        name: "comments_mode",
        description: "Task card comments: off (default), candidates, or all",
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: "off", value: "off" },
          { name: "candidates", value: "candidates" },
          { name: "all", value: "all" },
        ],
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

const INTERACTION_DEDUP_TTL_MS = 60 * 60 * 1000;
const seenInteractionIds = new Map<string, number>();
let auditInProgress = false;

function isDiscordApiError(
  err: unknown,
): err is { code: number; message?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

function formatDiscordError(err: unknown): string {
  if (isDiscordApiError(err)) {
    return `${err.code}: ${err.message ?? "Discord API error"}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Расширенный лог: кто вызвал, guild, channel, команда, ошибка. */
function logInteraction(
  tag: string,
  interaction: ChatInputCommandInteraction,
  extra?: Record<string, string>,
): void {
  const lines = [
    `[${tag}]`,
    `user=${interaction.user.tag} (${interaction.user.id})`,
    `guild=${interaction.guild?.name ?? "(dm)"} (${interaction.guildId ?? "-"})`,
    `channel=${interaction.channelId}`,
    `command=/${interaction.commandName}`,
    `interaction=${interaction.id}`,
  ];
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      lines.push(`${key}=${value}`);
    }
  }
  console.log(lines.join("\n"));
}

function logInteractionError(
  tag: string,
  interaction: ChatInputCommandInteraction,
  err: unknown,
): void {
  logInteraction(tag, interaction, { error: formatDiscordError(err) });
}

function rememberInteractionOnce(interactionId: string): boolean {
  const now = Date.now();
  for (const [id, seenAt] of seenInteractionIds) {
    if (now - seenAt > INTERACTION_DEDUP_TTL_MS) {
      seenInteractionIds.delete(id);
    }
  }
  if (seenInteractionIds.has(interactionId)) {
    return false;
  }
  seenInteractionIds.set(interactionId, now);
  return true;
}

function logUserSlashPermission(
  interaction: ChatInputCommandInteraction,
): void {
  if (!interaction.inGuild()) return;
  const canUse = interaction.memberPermissions?.has(
    PermissionFlagsBits.UseApplicationCommands,
  );
  logInteraction("audit-user-perms", interaction, {
    UseApplicationCommands: canUse ? "yes" : "no",
  });
}

async function logBotChannelPermissions(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const channel = interaction.channel;
  if (!channel || !("permissionsFor" in channel)) return;

  try {
    const me =
      interaction.guild.members.me ??
      (await interaction.guild.members.fetchMe());
    const perms = channel.permissionsFor(me);
    if (!perms) {
      logInteraction("audit-perms", interaction, {
        botInChannel: "unknown",
      });
      return;
    }

    const checks: [string, boolean][] = [
      ["ViewChannel", perms.has(PermissionFlagsBits.ViewChannel)],
      ["SendMessages", perms.has(PermissionFlagsBits.SendMessages)],
      ["AttachFiles", perms.has(PermissionFlagsBits.AttachFiles)],
      [
        "UseApplicationCommands",
        perms.has(PermissionFlagsBits.UseApplicationCommands),
      ],
      ["EmbedLinks", perms.has(PermissionFlagsBits.EmbedLinks)],
    ];
    const granted = checks.filter(([, ok]) => ok).map(([n]) => n);
    const missing = checks.filter(([, ok]) => !ok).map(([n]) => n);
    logInteraction("audit-perms", interaction, {
      granted: granted.join(",") || "(none)",
      missing: missing.join(",") || "(none)",
    });
  } catch (err) {
    logInteractionError("audit-perms", interaction, err);
  }
}

async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<boolean> {
  try {
    await interaction.editReply({ content });
    return true;
  } catch (err) {
    logInteractionError("audit", interaction, err);
    return false;
  }
}

async function notifyUserDm(
  interaction: ChatInputCommandInteraction,
  content: string,
  files?: AttachmentBuilder[],
): Promise<void> {
  const text =
    content.length > 2000 ? `${content.slice(0, 1980)}…` : content;
  try {
    if (files && files.length > 0) {
      await interaction.user.send({ content: text });
      await interaction.user.send({ content: "📎 Report files", files });
      logInteraction("audit", interaction, {
        fallback: "dm_sent",
        files: String(files.length),
      });
      return;
    }
    await interaction.user.send(text);
    logInteraction("audit", interaction, { fallback: "dm_sent" });
  } catch (err) {
    logInteractionError("audit", interaction, err);
  }
}

/** Полный отчёт в ЛС (если interaction истёк или ephemeral недоступен). */
async function deliverFullReportViaDm(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
  preamble?: string,
): Promise<void> {
  const detail = formatAuditReply(out);
  const files = buildReportAttachments(out);
  const outputDir = path.resolve(out.output.dir);
  const body = preamble ? `${preamble}\n\n${detail}` : detail;
  const note =
    "\n\n_(Ответ в канале недоступен: Discord interaction истёк, обычно после 15 мин.)_";

  await notifyUserDm(interaction, `${body}${note}`, files);

  if (files.length === 0) {
    console.warn("No report files found for DM attachments");
    await notifyUserDm(
      interaction,
      `Файлы отчёта не найдены. Локальный путь: \`${outputDir}\``,
    );
  }
}

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
    logInteractionError("audit", interaction, err);
    await deliverFullReportViaDm(interaction, out);
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
    logInteractionError("audit", interaction, err);
    await deliverFullReportViaDm(
      interaction,
      out,
      `Не удалось отправить файлы в ephemeral. Локальный отчёт: \`${outputDir}\``,
    );
  }
}

async function replyWithAuditResult(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
): Promise<void> {
  const brief = formatBriefSummary(out);
  const summary = `✅ **Audit completed.**\n\n${brief}`;

  const replied = await safeEditReply(interaction, summary);
  if (!replied) {
    await deliverFullReportViaDm(interaction, out, summary);
    return;
  }

  await deliverEphemeralReport(interaction, out);
}

async function handleAuditCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  logInteraction("audit", interaction);
  logUserSlashPermission(interaction);
  await logBotChannelPermissions(interaction);

  if (auditInProgress) {
    await safeEditReply(
      interaction,
      "⏳ **Аудит уже выполняется** на машине бота. Дождитесь завершения и повторите команду.",
    );
    return;
  }

  const boardUrl =
    resolveBoardUrl(interaction.options.getString("board_url") ?? undefined) ||
    resolveBoardUrl(process.env.APPTASK_BOARD_URL);

  if (!boardUrl) {
    await safeEditReply(
      interaction,
      "Укажите URL доски: опция `board_url` (только https://…) или `APPTASK_BOARD_URL` в .env.",
    );
    return;
  }

  const limit = interaction.options.getInteger("limit");
  const envMaxCards = Number(process.env.APPTASK_AUDIT_MAX_CARDS ?? "0");
  const maxCards = limit ?? (envMaxCards > 0 ? envMaxCards : undefined);

  const commentsModeRaw = interaction.options.getString("comments_mode");
  const commentsAuditMode =
    commentsModeRaw === "off" ||
    commentsModeRaw === "candidates" ||
    commentsModeRaw === "all"
      ? (commentsModeRaw as CommentsAuditMode)
      : undefined;

  await safeEditReply(
    interaction,
    "⏳ **Audit started.** Сбор карточек и проверка правил…",
  );

  auditInProgress = true;
  try {
    logInteraction("audit", interaction, {
      board: boardUrl,
      limit: maxCards != null ? String(maxCards) : "all",
    });
    const out = await runAudit(boardUrl, null, {
      maxCards,
      commentsAuditMode,
    });
    logInteraction("audit", interaction, {
      status: "done",
      cards: String(out.result.meta.cardsChecked),
      fail: String(out.result.meta.failCount),
      warn: String(out.result.meta.warnCount),
    });
    await replyWithAuditResult(interaction, out);
  } catch (err) {
    logInteractionError("audit", interaction, err);
    const failMsg = "❌ **Audit failed.** Check bot console logs.";
    const replied = await safeEditReply(interaction, failMsg);
    if (!replied) {
      await notifyUserDm(
        interaction,
        `${failMsg}\n\nОшибка: \`${formatDiscordError(err)}\``,
      );
    }
  } finally {
    auditInProgress = false;
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

  if (!rememberInteractionOnce(interaction.id)) {
    console.log(
      `[discord] duplicate interaction ignored: ${interaction.id} command=/${interaction.commandName}`,
    );
    return;
  }

  const ephemeral = MessageFlags.Ephemeral;

  if (
    interaction.commandName === "project_add" ||
    interaction.commandName === "project_list" ||
    interaction.commandName === "project_remove"
  ) {
    logInteraction(interaction.commandName, interaction);
    try {
      await interaction.deferReply({ flags: ephemeral });
    } catch (err) {
      logInteractionError(interaction.commandName, interaction, err);
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
      logInteractionError(interaction.commandName, interaction, err);
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
    logInteractionError("audit", interaction, err);
    return;
  }

  await handleAuditCommand(interaction);
});

await client.login(token);
