import fs from "node:fs";
import path from "node:path";
import {
  AttachmentBuilder,
  ChannelType,
  Client,
  GatewayIntentBits,
  type Client as DiscordClient,
  PermissionFlagsBits,
  type SendableChannels,
  type User,
} from "discord.js";
import type { RunAuditResult } from "../app/run-audit.js";
import type { EnrichCommentsResult } from "../comments/enrich-tasks-comments.js";
import { buildAuditReportEmbed } from "./report-embeds.js";

export function isAuditDiscordDmOnly(): boolean {
  const v = process.env.AUDIT_DISCORD_DM_ONLY?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Единый канал публикации: AUDIT_DISCORD_CHANNEL_ID (Атаев Маркет), иначе fallback. */
export function getAuditPublishChannelId(fallback?: string | null): string | null {
  const configured = process.env.AUDIT_DISCORD_CHANNEL_ID?.trim();
  if (configured) return configured;
  const fb = fallback?.trim();
  return fb || null;
}

async function waitForDiscordClient(client: DiscordClient): Promise<void> {
  if (client.isReady()) return;
  await new Promise<void>((resolve, reject) => {
    client.once("clientReady", () => resolve());
    client.once("error", reject);
  });
}

/** Публикует отчёт в AUDIT_DISCORD_CHANNEL_ID через бота (без webhook). */
export async function publishAuditToConfiguredChannel(
  out: RunAuditResult,
): Promise<string[]> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelId = getAuditPublishChannelId();
  if (!token || !channelId) {
    throw new Error("DISCORD_BOT_TOKEN or AUDIT_DISCORD_CHANNEL_ID is not set");
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(token);
    await waitForDiscordClient(client);
    const channel = await resolveAuditChannel(client, channelId);
    if (!channel) {
      throw new Error(`Cannot publish to channel ${channelId}`);
    }
    return await publishFullReportToChannel(channel, out, channelId);
  } finally {
    await client.destroy();
  }
}

export function formatCommentsAuditBlock(
  summary: EnrichCommentsResult | undefined,
): string {
  if (!summary) {
    return "\n\n**Комментарии:**\nmode: off\nchecked: 0";
  }
  if (summary.mode === "off") {
    return "\n\n**Комментарии:**\nmode: off\nchecked: 0";
  }
  const limitLine =
    summary.commentsLimit != null
      ? String(summary.commentsLimit)
      : "не задан";
  const durationSec = Math.max(0, Math.round(summary.durationMs / 1000));
  return [
    "",
    "**Комментарии:**",
    `board: ${summary.boardUrl}`,
    `boardId: ${summary.boardId}`,
    `mode: ${summary.mode}`,
    `limit: ${limitLine}`,
    `checked: ${summary.checkedComments}`,
    `with comments: ${summary.tasksWithComments}`,
    `duration: ${durationSec}s`,
  ].join("\n");
}

export function formatBriefSummary(out: RunAuditResult): string {
  const { meta } = out.result;
  const cardsLine =
    out.totalOnBoard > meta.cardsChecked
      ? `Checked **${meta.cardsChecked}** of **${out.totalOnBoard}** cards`
      : `Карточек: **${meta.cardsChecked}**`;
  return [
    `${cardsLine} | FAIL: **${meta.failCount}** | WARN: **${meta.warnCount}**`,
    `Доска: ${meta.boardUrl}`,
  ].join("\n");
}

export function formatAuditReply(out: RunAuditResult): string {
  const { meta } = out.result;
  const cardsLine =
    out.totalOnBoard > meta.cardsChecked
      ? `Checked **${meta.cardsChecked}** of **${out.totalOnBoard}** cards`
      : `Карточек: **${meta.cardsChecked}**`;
  const lines = [
    `📋 **Аудит AppTask — ${meta.projectName}**`,
    `${cardsLine} | FAIL: **${meta.failCount}** | WARN: **${meta.warnCount}**`,
    `Доска: ${meta.boardUrl}`,
  ];

  try {
    const summaryMd = fs.readFileSync(out.output.summaryPath, "utf8");
    const excerpt = summaryMd.split("\n").slice(0, 8).join("\n").trim();
    if (excerpt) {
      lines.push("", excerpt);
    }
  } catch {
    // summary.md optional in reply
  }

  lines.push(formatCommentsAuditBlock(out.commentsAudit));

  const text = lines.join("\n");
  return text.length > 2000 ? `${text.slice(0, 1980)}…` : text;
}

function logReportFile(label: string, filePath: string | undefined): void {
  console.log(`[attachments] ${label}: ${filePath ?? "(undefined)"}`);
  if (!filePath) return;
  const resolved = path.resolve(filePath);
  const exists = fs.existsSync(resolved);
  console.log(`[attachments]   existsSync=${exists} resolved=${resolved}`);
  if (exists) {
    console.log(`[attachments]   size=${fs.statSync(resolved).size}`);
  }
}

export function buildReportAttachments(
  out: RunAuditResult,
  options: { verbose?: boolean } = {},
): AttachmentBuilder[] {
  if (options.verbose) {
    console.log("audit output:", out.output);
    logReportFile("summaryPath", out.output.summaryPath);
    logReportFile("markdownPath", out.output.markdownPath);
    logReportFile("jsonPath", out.output.jsonPath);
    logReportFile("reportPath", out.output.reportPath);
    logReportFile("humanSummaryPath", out.output.humanSummaryPath);
    logReportFile("humanSummaryHtmlPath", out.output.humanSummaryHtmlPath);
  }

  const candidates = [
    { path: out.output.humanSummaryPath, name: "human-summary.md" },
    { path: out.output.reportPath, name: "audit-report.md" },
    { path: out.output.humanSummaryHtmlPath, name: "human-summary.html" },
  ];

  const files: AttachmentBuilder[] = [];
  for (const { path: filePath, name } of candidates) {
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) {
        console.warn(`[attachments] skip missing file: ${resolved}`);
        continue;
      }
      files.push(new AttachmentBuilder(resolved, { name }));
      if (options.verbose) {
        console.log(`[attachments] prepared: ${name} ← ${resolved}`);
      }
    } catch (err) {
      console.error(`[attachments] failed to prepare ${name}:`, err);
    }
  }

  if (options.verbose) {
    console.log(`[attachments] total files prepared: ${files.length}`);
  }
  return files;
}

export async function resolveAuditChannel(
  client: DiscordClient,
  channelId: string,
): Promise<SendableChannels | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      console.error(`[audit-channel] channel not found: ${channelId}`);
      return null;
    }

    if (!channel.isTextBased()) {
      console.error(
        `[audit-channel] channel is not text-based: ${channelId} (type=${channel.type})`,
      );
      return null;
    }

    if (!channel.isSendable()) {
      console.error(`[audit-channel] bot cannot send to channel: ${channelId}`);
      return null;
    }

    if ("guild" in channel && channel.guild) {
      const me = channel.guild.members.me;
      if (me) {
        const perms = channel.permissionsFor(me);
        if (!perms?.has(PermissionFlagsBits.ViewChannel)) {
          console.error(`[audit-channel] missing ViewChannel: ${channelId}`);
          return null;
        }
        if (!perms?.has(PermissionFlagsBits.SendMessages)) {
          console.error(`[audit-channel] missing SendMessages: ${channelId}`);
          return null;
        }
        if (!perms?.has(PermissionFlagsBits.AttachFiles)) {
          console.error(`[audit-channel] missing AttachFiles: ${channelId}`);
          return null;
        }
      }
    }

    const label =
      channel.type === ChannelType.GuildText ? `#${channel.name}` : channelId;
    console.log(`[audit-channel] resolved: ${label} (${channelId})`);
    return channel;
  } catch (err) {
    console.error(`[audit-channel] fetch failed for ${channelId}:`, err);
    return null;
  }
}

/** DM recipient for CLI publish (--dm): explicit user id or guild owner of audit channel. */
export async function resolveAuditDmUser(
  client: DiscordClient,
  options: { userId?: string | null; channelId?: string | null } = {},
): Promise<User | null> {
  const explicit = options.userId?.trim();
  if (explicit) {
    try {
      const user = await client.users.fetch(explicit);
      console.log(`[audit-dm] resolved user id=${user.id} tag=${user.tag}`);
      return user;
    } catch (err) {
      console.error(`[audit-dm] cannot fetch user ${explicit}:`, err);
      return null;
    }
  }

  const channelId = options.channelId?.trim();
  if (!channelId) {
    console.error(
      "[audit-dm] set AUDIT_DISCORD_DM_USER_ID or AUDIT_DISCORD_CHANNEL_ID",
    );
    return null;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("guild" in channel) || !channel.guild) {
      console.error(`[audit-dm] channel ${channelId} has no guild`);
      return null;
    }
    const owner = await channel.guild.fetchOwner();
    console.log(
      `[audit-dm] using guild owner id=${owner.id} tag=${owner.user.tag}`,
    );
    return owner.user;
  } catch (err) {
    console.error(`[audit-dm] resolve owner via channel ${channelId}:`, err);
    return null;
  }
}

/** Публикует summary + файлы в текстовый канал. Возвращает имена отправленных вложений. */
export async function publishFullReportToChannel(
  channel: SendableChannels,
  out: RunAuditResult,
  channelId: string,
): Promise<string[]> {
  const embed = buildAuditReportEmbed(out);
  const files = buildReportAttachments(out, { verbose: true });
  await channel.send({
    content: "Готово. Отчёт сформирован.",
    embeds: [embed],
  });

  const sentNames = files.map((f) => f.name).filter((n): n is string => !!n);

  if (files.length === 0) {
    console.warn("[audit-channel] No report files found for Discord attachments");
    return sentNames;
  }

  await channel.send({
    content: "Подробные файлы отчёта прикреплены ниже.",
    files,
  });
  console.log(
    `[audit-channel] posted summary + ${files.length} file(s) to channel ${channelId}`,
  );
  return sentNames;
}
