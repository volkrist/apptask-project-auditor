import {
  ChannelType,
  type Client,
  PermissionFlagsBits,
  type GuildBasedChannel,
} from "discord.js";

const AUDITOR_CHANNEL_NAME_RE = /^(аудитор|auditor)$/i;

/** Имя канала #аудитор на сервере (без #). */
export function isAuditorChannelName(name: string): boolean {
  return AUDITOR_CHANNEL_NAME_RE.test(name.trim());
}

function isPublishableTextChannel(
  channel: GuildBasedChannel,
): channel is GuildBasedChannel & { isSendable(): true } {
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
    !!perms?.has(PermissionFlagsBits.SendMessages) &&
    channel.isSendable()
  );
}

/** Канал #аудитор на сервере Discord (для публикации отчётов на новых серверах). */
export async function findGuildAuditorChannelId(
  client: Client,
  guildId: string,
): Promise<string | null> {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;

  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (!channel || !("name" in channel) || typeof channel.name !== "string") {
      continue;
    }
    if (!isAuditorChannelName(channel.name)) continue;
    if (!isPublishableTextChannel(channel as GuildBasedChannel)) continue;
    return channel.id;
  }
  return null;
}
