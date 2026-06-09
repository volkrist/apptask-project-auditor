import fs from "node:fs";
import path from "node:path";
import { AttachmentBuilder, type SendableChannels } from "discord.js";
import type { RunCommentsCheckResult } from "../app/run-comments-check.js";
import { buildCommentsReportEmbed } from "./report-embeds.js";

export function formatBriefCommentsSummary(out: RunCommentsCheckResult): string {
  const cardsLine =
    out.totalTasksOnBoard > out.checkedTasks
      ? `Checked **${out.checkedTasks}** of **${out.totalTasksOnBoard}** tasks`
      : `Checked **${out.checkedTasks}** tasks`;
  return [
    `${cardsLine} | With comments: **${out.tasksWithComments}** | Markers: **${out.markerHits.length}**`,
    `Доска: ${out.boardUrl}`,
  ].join("\n");
}

export function formatCommentsCheckReply(out: RunCommentsCheckResult): string {
  return `✅ **Comments check completed.**\n\n${formatBriefCommentsSummary(out)}\n\nReport files`;
}

export function buildCommentsReportAttachments(
  out: RunCommentsCheckResult,
): AttachmentBuilder[] {
  const candidates = [
    { path: out.output.reportPath, name: "comments-report.md" },
  ];

  const files: AttachmentBuilder[] = [];
  for (const { path: filePath, name } of candidates) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      console.warn(`[comments-report] skip missing file: ${resolved}`);
      continue;
    }
    files.push(new AttachmentBuilder(resolved, { name }));
  }
  return files;
}

/** @deprecated use buildCommentsReportAttachments */
export function buildCommentsReportAttachment(
  out: RunCommentsCheckResult,
): AttachmentBuilder[] {
  return buildCommentsReportAttachments(out);
}

export function logCommentsReportSent(
  files: AttachmentBuilder[] | string[],
): void {
  const names = files
    .map((f) => (typeof f === "string" ? f : f.name))
    .filter(Boolean)
    .join(", ");
  console.log(`[comments-report] sent files ${names}`);
}

/** Публикует summary + файлы проверки комментариев в канал (scheduled / cron). */
export async function publishFullCommentsReportToChannel(
  channel: SendableChannels,
  out: RunCommentsCheckResult,
  channelId: string,
): Promise<string[]> {
  const embed = buildCommentsReportEmbed(out);
  const files = buildCommentsReportAttachments(out);

  await channel.send({
    content: "Готово. Отчёт сформирован.",
    embeds: [embed],
  });

  const sentNames = files.map((f) => f.name).filter((n): n is string => !!n);
  if (files.length === 0) {
    console.warn("[comments-channel] No report files found for Discord attachments");
    return sentNames;
  }

  await channel.send({
    content: "Подробные файлы отчёта прикреплены ниже.",
    files,
  });
  console.log(
    `[comments-channel] posted summary + ${files.length} file(s) to channel ${channelId}`,
  );
  return sentNames;
}
