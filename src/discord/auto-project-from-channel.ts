import {
  ChannelType,
  type Client,
  PermissionFlagsBits,
  type GuildBasedChannel,
} from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { loadDbConfig } from "../collectors/db-config.js";
import { fetchBoardsWithDiscordLinks } from "../collectors/board-metadata.js";
import { closeDb } from "../collectors/db-client.js";
import type { AuditModePreset } from "../config/audit-modes.js";
import {
  addProject,
  extractBoardIdFromUrl,
  findProjectByGuildAndBoard,
  loadProjects,
  type ProjectConfig,
} from "../config/projects.js";
import { parseDiscordChannelRef } from "./parse-discord-channel.js";

function boardUrlForId(boardId: string, baseUrl: string): string {
  const m = baseUrl.match(/^(https?:\/\/[^/]+\/c\/\d+)/);
  const prefix = m?.[1] ?? "https://apptask.ru/c/7";
  return `${prefix}/board/${boardId}`;
}

function isLearnableGuildChannel(
  interaction: ChatInputCommandInteraction,
): interaction is ChatInputCommandInteraction & { channelId: string; guildId: string } {
  if (!interaction.guildId || !interaction.channelId) return false;
  const ch = interaction.channel;
  if (!ch) return false;
  return (
    ch.type === ChannelType.GuildText ||
    ch.type === ChannelType.GuildAnnouncement
  );
}

/**
 * Запоминает канал, из которого вызвали аудит одной доски (TurboWeave / audit_full).
 * Multi-board /audit (783+445+54) не привязывается — отчёт идёт в #аудитор.
 */
export function learnProjectChannelFromSlash(
  interaction: ChatInputCommandInteraction,
  input: {
    boardUrl: string;
    projectName: string;
    auditMode?: AuditModePreset;
    multiBoardAudit?: boolean;
  },
): ProjectConfig | null {
  if (input.multiBoardAudit) return null;
  if (!isLearnableGuildChannel(interaction)) return null;

  const boardId = extractBoardIdFromUrl(input.boardUrl);
  if (!boardId) return null;

  const existing = findProjectByGuildAndBoard(
    interaction.guildId,
    input.boardUrl,
  );
  if (existing?.discordChannelId === interaction.channelId) {
    return existing;
  }

  const project = addProject({
    name: input.projectName,
    boardUrl: input.boardUrl,
    discordChannelId: interaction.channelId,
    guildId: interaction.guildId,
  });

  console.log(
    `[audit-channel] auto-learned mapping board=${boardId} → channel=${interaction.channelId} (${project.name})`,
  );
  return project;
}

async function botCanSendToChannel(
  client: Client,
  channel: GuildBasedChannel,
): Promise<boolean> {
  if (
    channel.type !== ChannelType.GuildText &&
    channel.type !== ChannelType.GuildAnnouncement
  ) {
    return false;
  }
  const me = channel.guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return (
    !!perms?.has(PermissionFlagsBits.ViewChannel) &&
    !!perms?.has(PermissionFlagsBits.SendMessages)
  );
}

/** При старте бота: доски с discord_link в AppTask → projects.json, если бот видит канал. */
export async function syncAppTaskDiscordChannelMappings(
  client: Client,
  options: { guildId?: string; appTaskBaseUrl?: string } = {},
): Promise<number> {
  let synced = 0;
  try {
    const dbConfig = loadDbConfig();
    const boards = await fetchBoardsWithDiscordLinks(dbConfig);
    await closeDb();
    const baseUrl = options.appTaskBaseUrl ?? dbConfig.appTaskBaseUrl;

    for (const board of boards) {
      const channelId = parseDiscordChannelRef(board.discordLink);
      if (!channelId) continue;

      let channel;
      try {
        channel = await client.channels.fetch(channelId);
      } catch {
        continue;
      }
      if (!channel || !("guild" in channel) || !channel.guild) continue;
      if (options.guildId && channel.guild.id !== options.guildId) continue;
      if (!(await botCanSendToChannel(client, channel as GuildBasedChannel))) {
        continue;
      }

      const boardUrl = boardUrlForId(String(board.boardId), baseUrl);
      const name = board.name?.trim() || `Board ${board.boardId}`;
      const existing = loadProjects().find(
        (p) =>
          p.discordChannelId === channelId &&
          p.boardIds?.includes(String(board.boardId)),
      );
      if (existing) continue;

      addProject({
        name,
        boardUrl,
        discordChannelId: channelId,
        guildId: channel.guild.id,
      });
      synced++;
      console.log(
        `[audit-channel] synced AppTask board ${board.boardId} → channel ${channelId}`,
      );
    }
  } catch (err) {
    console.warn("[audit-channel] sync AppTask discord_link failed:", err);
  }
  return synced;
}
