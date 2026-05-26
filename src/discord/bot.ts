import "dotenv/config";
import { acquireBotInstanceLock } from "./bot-lock.js";
import path from "node:path";

acquireBotInstanceLock();
import {
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
import { isAuditLocked } from "../app/audit-lock.js";
import { runCommentsCheck } from "../app/run-comments-check.js";
import { runAudit, type RunAuditResult } from "../app/run-audit.js";
import {
  resolveAuditBoard,
  resolveBoardUrl,
  resolveCommentsBoard,
} from "./resolve-board-url.js";
import {
  formatAuditCommentsSlashCommandsForLog,
  formatRegisteredCommandsDetail,
  isLegacyAuditSlashCommand,
  isLegacyCommentsSlashCommand,
  isLongRunningSlashCommand,
  isProjectSlashCommand,
  LEGACY_AUDIT_DEPRECATION_MESSAGE,
  LEGACY_COMMENTS_DEPRECATION_MESSAGE,
  slashCommands,
  UNKNOWN_COMMAND_MESSAGE,
} from "./slash-commands.js";
import {
  addProject,
  loadProjects,
  removeProject,
} from "../config/projects.js";
import {
  buildCommentsReportAttachments,
  formatCommentsCheckReply,
  logCommentsReportSent,
} from "./publish-comments.js";
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

const INTERACTION_DEDUP_TTL_MS = 60 * 60 * 1000;
const seenInteractionIds = new Map<string, number>();
let auditInProgress = false;

const AUDIT_BUSY_MSG =
  "⏳ **Аудит уже выполняется, дождитесь завершения.**";
const EPHEMERAL = MessageFlags.Ephemeral;

function isAuditBusy(): boolean {
  return auditInProgress || isAuditLocked();
}

function logDiscord(line: string): void {
  console.log(line);
}

function logInteractionReceived(
  interaction: ChatInputCommandInteraction,
): void {
  logDiscord(
    `[discord] interaction received command=/${interaction.commandName} user=${interaction.user.id}`,
  );
}

function logDeferOk(commandName: string): void {
  logDiscord(`[discord] deferReply ok command=/${commandName}`);
}

function logAuditLockBusy(commandName: string): void {
  logDiscord(`[discord] audit lock busy command=/${commandName}`);
}

function logCommandFailed(commandName: string, err: unknown): void {
  logDiscord(
    `[discord] command failed command=/${commandName} error=${formatDiscordError(err)}`,
  );
}

function logEditReplySent(commandName: string): void {
  logDiscord(`[discord] editReply sent command=/${commandName}`);
}

function logStaleLegacyCommand(commandName: string): void {
  logDiscord(
    `[discord] stale legacy command=/${commandName} — use /audit_full, /audit_limit, /comments_full or /comments_limit`,
  );
}

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
  commandName?: string,
): Promise<boolean> {
  try {
    await interaction.editReply({ content });
    if (commandName) logEditReplySent(commandName);
    return true;
  } catch (err) {
    logInteractionError(commandName ?? "discord", interaction, err);
    return false;
  }
}

async function safeRespondError(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  message: string,
): Promise<void> {
  const text = message.length > 2000 ? `${message.slice(0, 1980)}…` : message;
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text });
      logEditReplySent(commandName);
      return;
    }
    await interaction.reply({ content: text, flags: EPHEMERAL });
    logEditReplySent(commandName);
  } catch (err) {
    logCommandFailed(commandName, err);
  }
}

async function deferLongRunningReply(
  interaction: ChatInputCommandInteraction,
  commandName: string,
): Promise<boolean> {
  try {
    await interaction.deferReply({ flags: EPHEMERAL });
    logDeferOk(commandName);
    return true;
  } catch (err) {
    logCommandFailed(commandName, err);
    await safeRespondError(
      interaction,
      commandName,
      `❌ Не удалось принять команду: \`${formatDiscordError(err)}\``,
    );
    return false;
  }
}

function resolveAuditMaxCards(
  interaction: ChatInputCommandInteraction,
  commandName: string,
): number | undefined {
  if (commandName === "audit_full") {
    return undefined;
  }
  if (commandName === "audit_limit") {
    return Math.min(500, interaction.options.getInteger("limit", true));
  }
  const limit = interaction.options.getInteger("limit");
  if (limit != null && limit > 0) {
    return Math.min(500, limit);
  }
  return undefined;
}

function resolveCommentsLimit(
  interaction: ChatInputCommandInteraction,
  commandName: string,
): number | undefined {
  if (commandName === "comments_full") {
    return undefined;
  }
  if (commandName === "comments_limit") {
    return Math.min(500, interaction.options.getInteger("limit", true));
  }
  const limit = interaction.options.getInteger("limit");
  if (limit != null && limit > 0) {
    return Math.min(500, limit);
  }
  return undefined;
}

async function runLongRunningCommand(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  work: () => Promise<void>,
): Promise<void> {
  if (isAuditBusy()) {
    logAuditLockBusy(commandName);
    await safeEditReply(interaction, AUDIT_BUSY_MSG, commandName);
    return;
  }

  auditInProgress = true;
  try {
    void logUserSlashPermission(interaction);
    void logBotChannelPermissions(interaction);
    await work();
  } catch (err) {
    logCommandFailed(commandName, err);
    await safeEditReply(
      interaction,
      `❌ **Ошибка:** \`${formatDiscordError(err)}\``,
      commandName,
    );
  } finally {
    auditInProgress = false;
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
  commandName: string,
): Promise<void> {
  const brief = formatBriefSummary(out);
  const summary = `✅ **Audit completed.**\n\n${brief}`;

  const replied = await safeEditReply(interaction, summary, commandName);
  if (!replied) {
    await deliverFullReportViaDm(interaction, out, summary);
    return;
  }

  await deliverEphemeralReport(interaction, out);
}

function resolveAuditBoardFromInteraction(
  interaction: ChatInputCommandInteraction,
): { boardUrl: string; source: string } | null {
  const boardUrlRaw = interaction.options.getString("board_url") ?? undefined;
  const resolved = resolveAuditBoard(
    boardUrlRaw,
    null,
    process.env.APPTASK_BOARD_URL,
  );
  if (!resolved) return null;
  return { boardUrl: resolved.boardUrl, source: resolved.source };
}

async function handleCommentsSlash(
  interaction: ChatInputCommandInteraction,
  options: { logTag: string; commandName: string; limit: number | undefined },
): Promise<void> {
  logInteraction(options.logTag, interaction);

  const boardUrlRaw = interaction.options.getString("board_url") ?? undefined;
  const resolved = resolveCommentsBoard(boardUrlRaw);
  if (!resolved) {
    const invalidExplicit = boardUrlRaw?.trim();
    await safeEditReply(
      interaction,
      invalidExplicit
        ? "Укажите корректный `board_url`, например: `https://apptask.ru/c/7/board/54`"
        : "Не указан board_url и не задан APPTASK_COMMENTS_BOARD_URL",
      options.commandName,
    );
    return;
  }

  const { boardUrl, source: boardSource } = resolved;

  const limitOpt =
    options.limit != null && options.limit > 0
      ? Math.min(500, Math.floor(options.limit))
      : undefined;

  if (options.limit != null) {
    console.log(
      `[${options.logTag}] boardUrl=${boardUrl} source=${boardSource} limit=${limitOpt}`,
    );
  } else {
    console.log(
      `[${options.logTag}] boardUrl=${boardUrl} source=${boardSource}`,
    );
  }

  await safeEditReply(
    interaction,
    `⏳ **Проверка комментариев…**\n📋 Доска: \`${boardUrl}\`${limitOpt != null ? `\n🔢 limit: ${limitOpt}` : "\n🔢 режим: full"}`,
    options.commandName,
  );

  logInteraction(options.logTag, interaction, {
    board: boardUrl,
    board_source: boardSource,
    board_url_raw: boardUrlRaw?.slice(0, 120) ?? "(env)",
    limit: limitOpt != null ? String(limitOpt) : "full",
  });
  const out = await runCommentsCheck(boardUrl, { limit: limitOpt });
  logInteraction(options.logTag, interaction, {
    status: "done",
    checked: String(out.checkedTasks),
    withComments: String(out.tasksWithComments),
    markers: String(out.markerHits.length),
  });
  const summary = formatCommentsCheckReply(out);
  const replied = await safeEditReply(interaction, summary, options.commandName);
  if (!replied) return;

  const files = buildCommentsReportAttachments(out);
  if (files.length === 0) {
    console.warn("[comments-report] no files to attach");
    return;
  }
  await interaction.followUp({
    content: "📎 Report files",
    files,
    flags: EPHEMERAL,
  });
  logCommentsReportSent(files);
}

async function handleAuditSlash(
  interaction: ChatInputCommandInteraction,
  options: {
    logTag: string;
    commandName: string;
    maxCards: number | undefined;
  },
): Promise<void> {
  logInteraction(options.logTag, interaction);

  const boardUrlRaw = interaction.options.getString("board_url") ?? undefined;
  const resolved = resolveAuditBoardFromInteraction(interaction);
  if (!resolved) {
    await safeEditReply(
      interaction,
      "Укажите доску: `board_url` (https://apptask.ru/c/7/board/445) или `APPTASK_BOARD_URL` в .env.",
      options.commandName,
    );
    return;
  }

  const { boardUrl, source: boardSource } = resolved;
  const maxCards = options.maxCards;

  const boardHint =
    boardSource === "env" ? "\n_(доска из .env)_" : "";

  if (maxCards != null) {
    console.log(
      `[${options.logTag}] boardUrl=${boardUrl} limit=${maxCards} comments=off`,
    );
  } else {
    console.log(`[${options.logTag}] boardUrl=${boardUrl} comments=off`);
  }

  await safeEditReply(
    interaction,
    `⏳ **Audit started.**\n📋 Доска: \`${boardUrl}\`${boardHint}${maxCards != null ? `\n🔢 limit: ${maxCards}` : "\n🔢 режим: full"}\nСбор карточек и проверка правил…`,
    options.commandName,
  );

  logInteraction(options.logTag, interaction, {
    board: boardUrl,
    board_source: boardSource,
    board_url_raw: boardUrlRaw?.slice(0, 120) ?? "(env)",
    limit: maxCards != null ? String(maxCards) : "full",
    comments: "off",
  });
  const out = await runAudit(boardUrl, null, {
    maxCards,
    commentsAuditMode: "off",
  });
  logInteraction(options.logTag, interaction, {
    status: "done",
    cards: String(out.result.meta.cardsChecked),
    fail: String(out.result.meta.failCount),
    warn: String(out.result.meta.warnCount),
  });
  await replyWithAuditResult(interaction, out, options.commandName);
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

  async function registerGuildCommands(
    targetGuildId: string,
    label: string,
  ): Promise<void> {
    await rest.put(
      Routes.applicationGuildCommands(readyClient.user.id, targetGuildId),
      { body: [...slashCommands] },
    );
    logDiscord(`[discord] guild id=${targetGuildId} (${label})`);
    for (const line of formatRegisteredCommandsDetail()) {
      logDiscord(`[discord] registered ${line}`);
    }
    logDiscord(
      `[discord] slash commands replaced: ${formatAuditCommentsSlashCommandsForLog()}`,
    );
  }

  if (guildId) {
    await registerGuildCommands(guildId, `guild ${guildId}`);
    return;
  }

  if (readyClient.guilds.cache.size === 0) {
    console.warn(
      "Bot is not on any server — invite it, then restart. Slash commands were not registered.",
    );
    return;
  }

  for (const guild of readyClient.guilds.cache.values()) {
    await registerGuildCommands(guild.id, `${guild.name} (${guild.id})`);
  }
});

async function replyLegacyDeprecated(
  interaction: ChatInputCommandInteraction,
  commandName: string,
  message: string,
): Promise<void> {
  logStaleLegacyCommand(commandName);
  if (!(await deferLongRunningReply(interaction, commandName))) return;
  await safeEditReply(interaction, message, commandName);
}

async function dispatchLongRunningSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const cmd = interaction.commandName;

  const isComments = cmd === "comments_full" || cmd === "comments_limit";

  if (isComments) {
    const limit = resolveCommentsLimit(interaction, cmd);
    const logTag =
      limit != null ? "comments-limit-command" : "comments-full-command";
    await runLongRunningCommand(interaction, cmd, () =>
      handleCommentsSlash(interaction, {
        logTag,
        commandName: cmd,
        limit,
      }),
    );
    return;
  }

  const maxCards = resolveAuditMaxCards(interaction, cmd);
  const logTag = maxCards != null ? "audit-limit-command" : "audit-full-command";
  await runLongRunningCommand(interaction, cmd, () =>
    handleAuditSlash(interaction, {
      logTag,
      commandName: cmd,
      maxCards,
    }),
  );
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!rememberInteractionOnce(interaction.id)) {
    logDiscord(
      `[discord] duplicate interaction ignored: ${interaction.id} command=/${interaction.commandName}`,
    );
    return;
  }

  const cmd = interaction.commandName;
  logInteractionReceived(interaction);

  if (isProjectSlashCommand(cmd)) {
    if (!(await deferLongRunningReply(interaction, cmd))) return;
    try {
      logInteraction(cmd, interaction);
      if (cmd === "project_add") {
        await handleProjectAdd(interaction);
      } else if (cmd === "project_list") {
        await handleProjectList(interaction);
      } else {
        await handleProjectRemove(interaction);
      }
      logEditReplySent(cmd);
    } catch (err) {
      logCommandFailed(cmd, err);
      await safeRespondError(
        interaction,
        cmd,
        `❌ Ошибка: \`${formatDiscordError(err)}\``,
      );
    }
    return;
  }

  if (isLegacyAuditSlashCommand(cmd)) {
    await replyLegacyDeprecated(
      interaction,
      cmd,
      LEGACY_AUDIT_DEPRECATION_MESSAGE,
    );
    return;
  }

  if (isLegacyCommentsSlashCommand(cmd)) {
    await replyLegacyDeprecated(
      interaction,
      cmd,
      LEGACY_COMMENTS_DEPRECATION_MESSAGE,
    );
    return;
  }

  if (isLongRunningSlashCommand(cmd)) {
    if (!(await deferLongRunningReply(interaction, cmd))) return;
    await dispatchLongRunningSlash(interaction);
    return;
  }

  logDiscord(
    `[discord] unknown command=/${cmd} user=${interaction.user.id} (stale or unregistered slash)`,
  );
  if (!(await deferLongRunningReply(interaction, cmd))) return;
  await safeEditReply(interaction, UNKNOWN_COMMAND_MESSAGE, cmd);
});

await client.login(token);
