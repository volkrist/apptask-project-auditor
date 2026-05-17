import fs from "node:fs";
import path from "node:path";
import {
  AttachmentBuilder,
  ChannelType,
  type Client,
  PermissionFlagsBits,
  type SendableChannels,
} from "discord.js";
import type { RunAuditResult } from "../app/run-audit.js";

export function formatBriefSummary(out: RunAuditResult): string {
  const { meta } = out.result;
  const cardsLine =
    out.totalOnBoard > meta.cardsChecked
      ? `Checked **${meta.cardsChecked}** of **${out.totalOnBoard}** cards`
      : `Карточек: **${meta.cardsChecked}**`;
  return [
    `${cardsLine} | FAIL: **${meta.failCount}** | WARN: **${meta.warnCount}**`,
    `Доска: ${meta.boardUrl}`,
    `Отчёт: \`${path.resolve(out.output.dir)}\``,
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
    `Отчёт: \`${path.resolve(out.output.dir)}\``,
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
  }

  const candidates = [
    { path: out.output.summaryPath, name: "audit-summary.md" },
    { path: out.output.markdownPath, name: "audit-detailed.md" },
    { path: out.output.jsonPath, name: "audit.json" },
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
  client: Client,
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

/** Публикует summary + файлы в текстовый канал. Возвращает имена отправленных вложений. */
export async function publishFullReportToChannel(
  channel: SendableChannels,
  out: RunAuditResult,
  channelId: string,
): Promise<string[]> {
  const content = formatAuditReply(out);
  const files = buildReportAttachments(out, { verbose: true });

  await channel.send({ content });

  const sentNames = files.map((f) => f.name).filter((n): n is string => !!n);

  if (files.length === 0) {
    console.warn("[audit-channel] No report files found for Discord attachments");
    return sentNames;
  }

  await channel.send({ content: "📎 Report files", files });
  console.log(
    `[audit-channel] posted summary + ${files.length} file(s) to channel ${channelId}`,
  );
  return sentNames;
}
