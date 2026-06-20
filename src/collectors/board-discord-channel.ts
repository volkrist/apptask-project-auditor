import { extractBoardIdFromUrl } from "../config/projects.js";
import type { BoardMetadataById } from "./board-metadata.js";
import { parseDiscordChannelRef } from "../discord/parse-discord-channel.js";

export type AppTaskDiscordChannelResolution = {
  channelId: string | null;
  boardId: string | null;
  rawLink: string | null;
};

/** ID досок из URL аудита (одна или несколько через запятую). */
export function boardIdsFromAuditBoardUrl(boardUrl: string): string[] {
  const ids: string[] = [];
  for (const part of boardUrl.split(",")) {
    const bid = extractBoardIdFromUrl(part.trim());
    if (bid && !ids.includes(bid)) ids.push(bid);
  }
  return ids;
}

/** Канал публикации из Boards.discord_link (первая доска с заполненной ссылкой). */
export function resolveAppTaskDiscordChannel(
  boardMetadata: BoardMetadataById | undefined,
  boardIds: string[],
): AppTaskDiscordChannelResolution {
  if (!boardMetadata || boardIds.length === 0) {
    return { channelId: null, boardId: null, rawLink: null };
  }

  const found: Array<{ boardId: string; channelId: string; rawLink: string }> =
    [];

  for (const boardId of boardIds) {
    const meta = boardMetadata[boardId];
    const rawLink = meta?.discordLink?.trim() || null;
    if (!rawLink) continue;
    const channelId = parseDiscordChannelRef(rawLink);
    if (channelId) {
      found.push({ boardId, channelId, rawLink });
    }
  }

  if (found.length === 0) {
    return { channelId: null, boardId: null, rawLink: null };
  }

  const uniqueChannels = new Set(found.map((f) => f.channelId));
  if (uniqueChannels.size > 1) {
    console.warn(
      `[audit-channel] несколько discord_link на досках (${boardIds.join(",")}); используется доска ${found[0]!.boardId}`,
    );
  }

  const pick = found[0]!;
  return {
    channelId: pick.channelId,
    boardId: pick.boardId,
    rawLink: pick.rawLink,
  };
}

export function resolveAppTaskDiscordChannelForAudit(
  boardMetadata: BoardMetadataById | undefined,
  boardUrl: string,
  boardSummaries?: Array<{ boardId: string }>,
): AppTaskDiscordChannelResolution {
  const ids =
    boardSummaries && boardSummaries.length > 0
      ? boardSummaries.map((s) => s.boardId)
      : boardIdsFromAuditBoardUrl(boardUrl);
  return resolveAppTaskDiscordChannel(boardMetadata, ids);
}
