import "dotenv/config";
import { acquireBotInstanceLock } from "./bot-lock.js";

acquireBotInstanceLock();
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  type InteractionEditReplyOptions,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import { loadAuditScope } from "../config/audit-scope.js";
import {
  applyAuditModeEnv,
  describeAuditMode,
  FULL_AUDIT_CONFIG,
  restoreAuditModeEnv,
  TURBOWEAVE_AUDIT_CONFIG,
  type AuditModePreset,
} from "../config/audit-modes.js";
import { parseBoardIds } from "../collectors/db-config.js";
import { runCommentsCheck } from "../app/run-comments-check.js";
import { runAudit, type RunAuditResult } from "../app/run-audit.js";
import {
  resolveAuditBoard,
  resolveBoardUrl,
  resolveCommentsBoard,
} from "./resolve-board-url.js";
import {
  AUDIT_SLASH_COMMANDS,
  COMMENTS_SLASH_COMMANDS,
  formatMainSlashCommandsForLog,
  formatSlashCommandsDetailForLog,
  formatSlashCommandsForLog,
  LEGACY_COMMENTS_DEPRECATION_MESSAGE,
  UNSUPPORTED_COMMAND_MESSAGE,
  slashCommands,
} from "./slash-commands.js";
import {
  addProject,
  loadProjects,
  removeProject,
} from "../config/projects.js";
import {
  addIgnoredTask,
  listIgnoredTasks,
  normalizeBoardUrl,
  removeIgnoredTask,
  resolveTaskUrl,
} from "../audit-ignore/ignored-tasks.js";
import {
  buildCommentsReportAttachments,
  logCommentsReportSent,
  publishFullCommentsReportToChannel,
} from "./publish-comments.js";
import {
  buildReportAttachments,
  formatBriefSummary,
  getAuditPublishChannelId,
  isAuditDiscordDmOnly,
  publishFullReportToChannel,
  resolveAuditChannel,
} from "./publish-report.js";
import {
  buildAuditReportEmbed,
  buildCommentsReportEmbed,
  humanizeRuleLabel,
  recommendationForRule,
} from "./report-embeds.js";
import type { RunCommentsCheckResult } from "../app/run-comments-check.js";
import type { SendableChannels } from "discord.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("DISCORD_BOT_TOKEN is not set in .env");
  process.exit(1);
}

const auditChannelId = getAuditPublishChannelId();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const INTERACTION_DEDUP_TTL_MS = 60 * 60 * 1000;
const seenInteractionIds = new Map<string, number>();
let auditInProgress = false;
const reportPageState = new Map<string, PagedReportState>();

const AUDIT_BUSY_MESSAGE =
  "⏳ **Аудит уже выполняется, дождитесь завершения.**";

type ReportKind = "audit" | "comments";
type ReportFileRef = { path: string; name: string };
type PagedReportState = {
  kind: ReportKind;
  pages: EmbedBuilder[];
  currentPage: number;
  files: ReportFileRef[];
};

function logDiscord(message: string): void {
  console.log(message);
}

function isActiveAuditCommand(commandName: string): boolean {
  return (AUDIT_SLASH_COMMANDS as readonly string[]).includes(commandName);
}

function isActiveCommentsCommand(commandName: string): boolean {
  return (COMMENTS_SLASH_COMMANDS as readonly string[]).includes(commandName);
}

async function replyEphemeralHelp(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (!(await deferSlashCommand(interaction, { ephemeral: true }))) {
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content,
          flags: MessageFlags.Ephemeral,
        });
        logDiscord(
          `[discord] reply sent command=/${interaction.commandName}`,
        );
      }
    } catch (err) {
      logDiscord(
        `[discord] reply failed command=/${interaction.commandName} error=${formatDiscordError(err)}`,
      );
    }
    return;
  }
  await replyAfterDefer(interaction, content);
}

async function deferSlashCommand(
  interaction: ChatInputCommandInteraction,
  options: { ephemeral?: boolean } = {},
): Promise<boolean> {
  const cmd = interaction.commandName;
  logDiscord(
    `[discord] interaction received command=/${cmd} user=${interaction.user.id}`,
  );
  try {
    if (options.ephemeral) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }
    logDiscord(`[discord] deferReply ok command=/${cmd}`);
    return true;
  } catch (err) {
    logDiscord(
      `[discord] deferReply failed command=/${cmd} error=${formatDiscordError(err)}`,
    );
    return false;
  }
}

async function replyAfterDefer(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  const cmd = interaction.commandName;
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
    logDiscord(`[discord] editReply sent command=/${cmd}`);
    return;
  }
  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
  logDiscord(`[discord] reply sent command=/${cmd}`);
}

async function replyCommandFailed(
  interaction: ChatInputCommandInteraction,
  err: unknown,
): Promise<void> {
  const cmd = interaction.commandName;
  logDiscord(
    `[discord] command failed command=/${cmd} error=${formatDiscordError(err)}`,
  );
  const text = `❌ **Ошибка:** \`${formatDiscordError(err)}\``;
  try {
    await replyAfterDefer(interaction, text);
  } catch (replyErr) {
    logDiscord(
      `[discord] error reply failed command=/${cmd} error=${formatDiscordError(replyErr)}`,
    );
  }
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

function getAuditStatusText(failCount: number, warnCount: number): string {
  if (failCount > 0) return "Требует доработки";
  if (warnCount > 0) return "Есть предупреждения";
  return "Проблем не найдено";
}

function buildPagerButtons(page: number, total: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("report_prev")
      .setLabel("◀ Назад")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId("report_next")
      .setLabel("▶ Далее")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= total - 1),
    new ButtonBuilder()
      .setCustomId("report_download")
      .setLabel("⬇ Скачать отчёт")
      .setStyle(ButtonStyle.Primary),
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildAuditDetailPages(out: RunAuditResult): EmbedBuilder[] {
  const problematic = out.result.cards.filter((card) =>
    card.results.some((r) => r.status !== "PASS"),
  );
  const chunks = chunk(problematic, 2);
  const pages: EmbedBuilder[] = [];

  for (const group of chunks) {
    const embed = new EmbedBuilder()
      .setTitle(`✅ Аудит ${out.result.meta.projectName} завершён`)
      .setColor(0x5865f2)
      .setDescription("Детализация по карточкам");

    for (const card of group) {
      const issues = card.results
        .filter((r) => r.status !== "PASS")
        .map((r) => `- ${humanizeRuleLabel(r.ruleId, r.reason)}`)
        .slice(0, 8);
      const fixes = card.results
        .map((r) => recommendationForRule(r.ruleId))
        .filter((x): x is string => !!x);
      const uniqueFixes = [...new Set(fixes)].slice(0, 6).map((x) => `- ${x}`);
      const fail = card.results.filter((r) => r.status === "FAIL").length;
      const warn = card.results.filter((r) => r.status === "WARN").length;
      const status = getAuditStatusText(fail, warn);
      const title = card.task.title ?? "(без названия)";
      const cardHeader = `### №${card.task.id ?? "?"} — ${title}`;
      const value = [
        cardHeader,
        `Ссылка: ${card.task.url ?? "—"}`,
        `Статус: ${status}`,
        "",
        "Проблемы:",
        ...(issues.length > 0 ? issues : ["- Нарушений не найдено"]),
        "",
        "Что исправить:",
        ...(uniqueFixes.length > 0 ? uniqueFixes : ["- Проверить карточку вручную"]),
      ].join("\n");
      embed.addFields({ name: "\u200b", value: value.slice(0, 1024), inline: false });
    }
    pages.push(embed);
  }
  return pages;
}

function buildCommentsDetailPages(out: RunCommentsCheckResult): EmbedBuilder[] {
  if (out.markerHits.length === 0) return [];
  const groups = chunk(out.markerHits, 3);
  return groups.map((group) => {
    const embed = new EmbedBuilder()
      .setTitle("✅ Проверка комментариев завершена")
      .setColor(0x5865f2)
      .setDescription("Детализация по маркерам");
    for (const hit of group) {
      embed.addFields({
        name: `№${hit.taskId} — ${hit.taskTitle ?? "(без названия)"}`,
        value: [
          `Ссылка: ${hit.taskUrl}`,
          `Маркер: ${hit.marker}`,
          `Комментарий: ${hit.commentPlain}`,
        ]
          .join("\n")
          .slice(0, 1024),
        inline: false,
      });
    }
    return embed;
  });
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

async function safeEditReplyPayload(
  interaction: ChatInputCommandInteraction,
  payload: string | InteractionEditReplyOptions,
): Promise<boolean> {
  const cmd = interaction.commandName;
  try {
    if (typeof payload === "string") {
      await interaction.editReply({ content: payload });
    } else {
      await interaction.editReply(payload);
    }
    logDiscord(`[discord] editReply sent command=/${cmd}`);
    return true;
  } catch (err) {
    logInteractionError("audit", interaction, err);
    return false;
  }
}

async function safeEditReply(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<boolean> {
  return safeEditReplyPayload(interaction, content);
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
      await interaction.user.send({
        content: "Подробные файлы отчёта прикреплены ниже.",
        files,
      });
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
  const detail = formatBriefSummary(out);
  const files = buildReportAttachments(out);
  const body = preamble ? `${preamble}\n\n${detail}` : detail;
  const note =
    "\n\n_(Ответ в канале недоступен: Discord interaction истёк, обычно после 15 мин.)_";

  await notifyUserDm(interaction, `${body}${note}`, files);

  if (files.length === 0) {
    console.warn("No report files found for DM attachments");
    await notifyUserDm(interaction, "Файлы отчёта не найдены.");
  }
}

/** Канал для публичного отчёта: AUDIT_DISCORD_CHANNEL_ID (Атаев Маркет), иначе канал команды. */
async function resolveReportChannel(
  interaction: ChatInputCommandInteraction,
): Promise<SendableChannels | null> {
  const fallback =
    interaction.channel?.isTextBased() && interaction.channel.isSendable()
      ? interaction.channelId
      : null;
  const channelId = getAuditPublishChannelId(fallback);
  if (!channelId) return null;
  return resolveAuditChannel(client, channelId);
}

async function deliverPagedAuditReport(
  channel: SendableChannels,
  out: RunAuditResult,
  logLabel: string,
): Promise<void> {
  const summary = buildAuditReportEmbed(out).addFields({
    name: "Детали",
    value: "Отчёт доступен ниже. Используйте кнопки для просмотра деталей.",
    inline: false,
  });
  const detailPages = buildAuditDetailPages(out);
  const pages = [summary, ...detailPages];
  for (let i = 0; i < pages.length; i++) {
    pages[i] = EmbedBuilder.from(pages[i]).setFooter({
      text: `Страница ${i + 1} из ${pages.length}`,
    });
  }
  const sent = await channel.send({
    content: "Готово. Отчёт сформирован.",
    embeds: [pages[0]!],
    components: [buildPagerButtons(0, pages.length)],
  });
  reportPageState.set(sent.id, {
    kind: "audit",
    pages,
    currentPage: 0,
    files: [
      { path: out.output.reportPath, name: "audit-report.md" },
      { path: out.output.jsonPath, name: "audit.json" },
    ],
  });
  console.log(
    `[attachments] audit report → ${logLabel} (paged message ${sent.id})`,
  );
}

/** Полный отчёт в ЛС пользователю (AUDIT_DISCORD_DM_ONLY). */
async function deliverDmAuditReport(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
): Promise<void> {
  try {
    const dm = await interaction.user.createDM();
    await deliverPagedAuditReport(
      dm,
      out,
      `DM user ${interaction.user.id} (${interaction.user.tag})`,
    );
  } catch (err) {
    logInteractionError("audit", interaction, err);
    await safeEditReply(
      interaction,
      "Не удалось отправить отчёт в личные сообщения. Разрешите ЛС от участников сервера.",
    );
  }
}

/** Полный отчёт в канал — виден всем участникам канала. */
async function deliverPublicAuditReport(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
): Promise<void> {
  const channel = await resolveReportChannel(interaction);
  if (!channel) {
    console.warn("[audit-channel] no channel for public report");
    await safeEditReply(
      interaction,
      "Не удалось найти канал для публикации отчёта.",
    );
    return;
  }

  try {
    await deliverPagedAuditReport(channel, out, `channel ${channel.id}`);
  } catch (err) {
    logInteractionError("audit", interaction, err);
    await safeEditReply(interaction, "Не удалось опубликовать отчёт в канал.");
  }
}

async function deliverPagedCommentsReport(
  channel: SendableChannels,
  out: RunCommentsCheckResult,
  logLabel: string,
): Promise<void> {
  const summary = buildCommentsReportEmbed(out).addFields({
    name: "Детали",
    value: "Отчёт доступен ниже. Используйте кнопки для просмотра деталей.",
    inline: false,
  });
  const detailPages = buildCommentsDetailPages(out);
  const pages = [summary, ...detailPages];
  for (let i = 0; i < pages.length; i++) {
    pages[i] = EmbedBuilder.from(pages[i]).setFooter({
      text: `Страница ${i + 1} из ${pages.length}`,
    });
  }
  const sent = await channel.send({
    content: "Готово. Отчёт сформирован.",
    embeds: [pages[0]!],
    components: [buildPagerButtons(0, pages.length)],
  });
  reportPageState.set(sent.id, {
    kind: "comments",
    pages,
    currentPage: 0,
    files: [
      { path: out.output.reportPath, name: "comments-report.md" },
      { path: out.output.jsonPath, name: "comments.json" },
    ],
  });
  logCommentsReportSent([out.output.reportPath]);
  console.log(
    `[comments-report] report → ${logLabel} (paged message ${sent.id})`,
  );
}

async function deliverPublicCommentsReport(
  interaction: ChatInputCommandInteraction,
  out: RunCommentsCheckResult,
): Promise<void> {
  const channel = await resolveReportChannel(interaction);
  if (!channel) {
    console.warn("[comments-channel] no channel for public report");
    return;
  }

  try {
    await deliverPagedCommentsReport(channel, out, `channel ${channel.id}`);
  } catch (err) {
    logInteractionError("comments", interaction, err);
  }
}

async function deliverDmCommentsReport(
  interaction: ChatInputCommandInteraction,
  out: RunCommentsCheckResult,
): Promise<void> {
  try {
    const dm = await interaction.user.createDM();
    await deliverPagedCommentsReport(
      dm,
      out,
      `DM user ${interaction.user.id} (${interaction.user.tag})`,
    );
  } catch (err) {
    logInteractionError("comments", interaction, err);
    await safeEditReply(
      interaction,
      "Не удалось отправить отчёт в личные сообщения. Разрешите ЛС от участников сервера.",
    );
  }
}

async function replyWithAuditResult(
  interaction: ChatInputCommandInteraction,
  out: RunAuditResult,
): Promise<void> {
  const summary = "Готово. Отчёт сформирован.";
  const replied = await safeEditReply(interaction, summary);
  if (!replied) {
    return;
  }
  if (isAuditDiscordDmOnly()) {
    await deliverDmAuditReport(interaction, out);
  } else {
    await deliverPublicAuditReport(interaction, out);
  }
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
  options: { logTag: string; limit: number | undefined },
): Promise<void> {
  logInteraction(options.logTag, interaction);
  logUserSlashPermission(interaction);
  void logBotChannelPermissions(interaction).catch(() => undefined);

  const boardUrlRaw = interaction.options.getString("board_url") ?? undefined;
  const resolved = resolveCommentsBoard(boardUrlRaw);
  if (!resolved) {
    const invalidExplicit = boardUrlRaw?.trim();
    await safeEditReply(
      interaction,
      invalidExplicit
        ? "Укажите корректный `board_url`, например: `https://apptask.ru/c/7/board/54`"
        : "Не указан board_url и не задан APPTASK_COMMENTS_BOARD_URL",
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
  );

  try {
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
    const summary = "Готово. Отчёт сформирован.";
    const replied = await safeEditReply(interaction, summary);
    if (!replied) return;
    if (isAuditDiscordDmOnly()) {
      await deliverDmCommentsReport(interaction, out);
    } else {
      await deliverPublicCommentsReport(interaction, out);
    }
  } catch (err) {
    logInteractionError(options.logTag, interaction, err);
    await safeEditReply(
      interaction,
      `❌ **Проверка комментариев не удалась.**\n\`${formatDiscordError(err)}\``,
    );
  }
}

async function handleAuditSlash(
  interaction: ChatInputCommandInteraction,
  options: {
    logTag: string;
    maxCards: number | undefined;
    auditMode?: AuditModePreset;
  },
): Promise<void> {
  logInteraction(options.logTag, interaction);
  logUserSlashPermission(interaction);
  void logBotChannelPermissions(interaction).catch(() => undefined);

  const envSnapshot =
    options.auditMode != null
      ? applyAuditModeEnv(options.auditMode)
      : null;

  try {
    const boardUrlRaw = interaction.options.getString("board_url") ?? undefined;
    let boardUrl: string;
    let boardSource: string;

    if (options.auditMode === "turboweave") {
      boardUrl = TURBOWEAVE_AUDIT_CONFIG.boardUrl;
      boardSource = "turboweave";
    } else if (options.auditMode === "full") {
      const resolved = boardUrlRaw
        ? resolveAuditBoard(boardUrlRaw, null, process.env.APPTASK_BOARD_URL)
        : resolveAuditBoardFromInteraction(interaction);
      if (!resolved) {
        boardUrl = FULL_AUDIT_CONFIG.boardUrl;
        boardSource = "full-default";
      } else {
        boardUrl = resolved.boardUrl;
        boardSource = resolved.source;
      }
    } else {
      const resolved = resolveAuditBoardFromInteraction(interaction);
      if (!resolved) {
        await safeEditReply(
          interaction,
          "Укажите доску: `board_url` (https://apptask.ru/c/7/board/445) или `APPTASK_BOARD_URL` в .env.",
        );
        return;
      }
      boardUrl = resolved.boardUrl;
      boardSource = resolved.source;
    }

    const maxCards = options.maxCards;

    const boardHint =
      boardSource === "env" ? "\n_(доска из .env)_" : "";

    const auditScope = loadAuditScope();
    const configuredBoardIds = parseBoardIds(process.env.APPTASK_DB_BOARD_IDS);
    const modeHint = options.auditMode
      ? `\n📦 ${describeAuditMode(options.auditMode)}`
      : "";
    const scopeHint =
      auditScope === "multi" && configuredBoardIds.length > 0
        ? `\n📋 доски: ${configuredBoardIds.join(", ")}`
        : "";

    if (maxCards != null) {
      console.log(
        `[${options.logTag}] boardUrl=${boardUrl} limit=${maxCards} comments=off mode=${options.auditMode ?? "env"}`,
      );
    } else {
      console.log(
        `[${options.logTag}] boardUrl=${boardUrl} comments=off mode=${options.auditMode ?? "env"}`,
      );
    }

    await safeEditReply(
      interaction,
      `⏳ **Audit started.**\n📋 Доска: \`${boardUrl}\`${boardHint}${modeHint}${scopeHint}${maxCards != null ? `\n🔢 limit: ${maxCards}` : "\n🔢 режим: full"}\nСбор карточек и проверка правил…`,
    );

    logInteraction(options.logTag, interaction, {
      board: boardUrl,
      board_source: boardSource,
      board_url_raw: boardUrlRaw?.slice(0, 120) ?? "(preset)",
      limit: maxCards != null ? String(maxCards) : "full",
      comments: "off",
      audit_mode: options.auditMode ?? "env",
    });
    const out = await runAudit(boardUrl, null, {
      maxCards,
      commentsAuditMode: "off",
      projectName:
        options.auditMode === "turboweave"
          ? TURBOWEAVE_AUDIT_CONFIG.projectName
          : options.auditMode === "full"
            ? FULL_AUDIT_CONFIG.projectName
            : undefined,
    });
    logInteraction(options.logTag, interaction, {
      status: "done",
      cards: String(out.result.meta.cardsChecked),
      fail: String(out.result.meta.failCount),
      warn: String(out.result.meta.warnCount),
    });
    await replyWithAuditResult(interaction, out);
  } catch (err) {
    logInteractionError(options.logTag, interaction, err);
    const failMsg = "❌ **Audit failed.** Check bot console logs.";
    const replied = await safeEditReply(interaction, failMsg);
    if (!replied) {
      await notifyUserDm(
        interaction,
        `${failMsg}\n\nОшибка: \`${formatDiscordError(err)}\``,
      );
    }
  } finally {
    if (envSnapshot) {
      restoreAuditModeEnv(envSnapshot);
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

async function handleAuditIgnore(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const url = interaction.options.getString("url", true);
  const reason = interaction.options.getString("reason") ?? undefined;
  const parsed = resolveTaskUrl(url);
  if (!parsed) {
    await interaction.editReply(
      "Укажите корректный URL карточки, например: https://apptask.ru/c/7/board/445/343",
    );
    return;
  }
  const result = addIgnoredTask({
    url: parsed.url,
    reason,
    createdBy: interaction.user.id,
  });
  if (!result.added) {
    await interaction.editReply(
      result.message ?? "Карточка уже есть в исключениях.",
    );
    return;
  }
  await interaction.editReply(
    "Карточка добавлена в исключения и не будет проверяться при следующих аудитах.",
  );
}

async function handleAuditUnignore(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const url = interaction.options.getString("url", true);
  const parsed = resolveTaskUrl(url);
  if (!parsed) {
    await interaction.editReply(
      "Укажите корректный URL карточки, например: https://apptask.ru/c/7/board/445/343",
    );
    return;
  }
  const result = removeIgnoredTask(parsed.url);
  await interaction.editReply(
    result.removed
      ? "Карточка удалена из исключений."
      : "Карточка не найдена в исключениях.",
  );
}

async function handleAuditIgnoredList(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const boardUrlRaw = interaction.options.getString("board_url") ?? undefined;
  const boardUrl = boardUrlRaw ? normalizeBoardUrl(boardUrlRaw) : undefined;
  const list = listIgnoredTasks(boardUrl);
  if (list.length === 0) {
    await interaction.editReply("Исключённых карточек нет.");
    return;
  }
  const lines = list.slice(0, 50).map((item) => {
    const reason = item.reason ? ` — ${item.reason}` : "";
    return `• ${item.url}${reason}`;
  });
  await interaction.editReply(lines.join("\n"));
}

client.once("clientReady", async (readyClient) => {
  console.log(`Discord bot logged in as ${readyClient.user.tag}`);
  if (isAuditDiscordDmOnly()) {
    console.log(
      "[audit-dm] AUDIT_DISCORD_DM_ONLY=true — reports go to user DM, not public channel",
    );
  } else if (auditChannelId) {
    console.log(
      `[audit-channel] all reports → ${auditChannelId} (AUDIT_DISCORD_CHANNEL_ID, Атаев Маркет)`,
    );
  }

  const rest = new REST().setToken(token);
  const guildId = process.env.DISCORD_GUILD_ID?.trim();

  async function registerGuildCommands(targetGuildId: string, label: string): Promise<void> {
    await rest.put(
      Routes.applicationGuildCommands(readyClient.user.id, targetGuildId),
      { body: [...slashCommands] },
    );
    console.log(`[discord] guild ${label} id=${targetGuildId}`);
    console.log(
      `[discord] slash commands replaced: ${formatMainSlashCommandsForLog()}`,
    );
    console.log(
      `[discord] all guild commands: ${formatSlashCommandsForLog()}`,
    );
    console.log(
      `[discord] slash command options: ${formatSlashCommandsDetailForLog()}`,
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

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    const state = reportPageState.get(interaction.message.id);
    if (!state) {
      await interaction.reply({
        content: "Отчёт больше недоступен. Запустите команду снова.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.customId === "report_prev") {
      state.currentPage = Math.max(0, state.currentPage - 1);
      await interaction.update({
        embeds: [state.pages[state.currentPage]!],
        components: [buildPagerButtons(state.currentPage, state.pages.length)],
      });
      return;
    }

    if (interaction.customId === "report_next") {
      state.currentPage = Math.min(state.pages.length - 1, state.currentPage + 1);
      await interaction.update({
        embeds: [state.pages[state.currentPage]!],
        components: [buildPagerButtons(state.currentPage, state.pages.length)],
      });
      return;
    }

    if (interaction.customId === "report_download") {
      const files = state.files
        .filter((f) => !!f.path)
        .map((f) => new AttachmentBuilder(f.path, { name: f.name }));
      if (files.length === 0) {
        await interaction.reply({
          content: "Файл отчёта не найден.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: "Файл отчёта для скачивания.",
        files,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;

  if (!rememberInteractionOnce(interaction.id)) {
    logDiscord(
      `[discord] duplicate interaction ignored: ${interaction.id} command=/${cmd}`,
    );
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Запрос уже обрабатывается.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch {
      // interaction token may already be consumed
    }
    return;
  }

  if (
    cmd === "project_add" ||
    cmd === "project_list" ||
    cmd === "project_remove" ||
    cmd === "audit_ignore" ||
    cmd === "audit_unignore" ||
    cmd === "audit_ignored_list"
  ) {
    if (!(await deferSlashCommand(interaction, { ephemeral: true }))) return;
    try {
      if (cmd === "project_add") {
        await handleProjectAdd(interaction);
      } else if (cmd === "project_list") {
        await handleProjectList(interaction);
      } else if (cmd === "audit_ignore") {
        await handleAuditIgnore(interaction);
      } else if (cmd === "audit_unignore") {
        await handleAuditUnignore(interaction);
      } else if (cmd === "audit_ignored_list") {
        await handleAuditIgnoredList(interaction);
      } else {
        await handleProjectRemove(interaction);
      }
    } catch (err) {
      await replyCommandFailed(interaction, err);
    }
    return;
  }

  if (cmd === "comments") {
    logDiscord(`[discord] legacy command=/${cmd} user=${interaction.user.id}`);
    await replyEphemeralHelp(interaction, LEGACY_COMMENTS_DEPRECATION_MESSAGE);
    return;
  }

  const isAudit = isActiveAuditCommand(cmd);
  const isComments = isActiveCommentsCommand(cmd);
  const isTurboWeave = cmd === "turboweave";

  if (!isAudit && !isComments && !isTurboWeave) {
    logDiscord(`[discord] unknown command=/${cmd} user=${interaction.user.id}`);
    await replyEphemeralHelp(interaction, UNSUPPORTED_COMMAND_MESSAGE);
    return;
  }

  if (!(await deferSlashCommand(interaction, { ephemeral: true }))) {
    return;
  }

  if (auditInProgress || isAuditLocked()) {
    logDiscord(`[discord] audit lock busy command=/${cmd}`);
    await replyAfterDefer(interaction, AUDIT_BUSY_MESSAGE);
    return;
  }

  auditInProgress = true;
  try {
    if (cmd === "comments_full") {
      await handleCommentsSlash(interaction, {
        logTag: "comments-full-command",
        limit: undefined,
      });
      return;
    }
    if (cmd === "comments_limit") {
      await handleCommentsSlash(interaction, {
        logTag: "comments-limit-command",
        limit: interaction.options.getInteger("limit", true),
      });
      return;
    }
    if (cmd === "turboweave") {
      await handleAuditSlash(interaction, {
        logTag: "turboweave-command",
        maxCards: undefined,
        auditMode: "turboweave",
      });
      return;
    }
    if (cmd === "audit") {
      const limit = interaction.options.getInteger("limit");
      await handleAuditSlash(interaction, {
        logTag: "audit-command",
        maxCards: limit != null ? Math.min(500, limit) : undefined,
        auditMode: "full",
      });
      return;
    }
    if (cmd === "audit_full") {
      await handleAuditSlash(interaction, {
        logTag: "audit-full-command",
        maxCards: undefined,
        auditMode: "full",
      });
      return;
    }
    if (cmd === "audit_limit") {
      await handleAuditSlash(interaction, {
        logTag: "audit-limit-command",
        maxCards: Math.min(500, interaction.options.getInteger("limit", true)),
        auditMode: "full",
      });
    }
  } catch (err) {
    await replyCommandFailed(interaction, err);
  } finally {
    auditInProgress = false;
  }
});

await client.login(token);
