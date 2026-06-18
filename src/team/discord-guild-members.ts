import { Client, GatewayIntentBits } from "discord.js";

export type DiscordTeamContext = {
  loaded: boolean;
  guildId: string | null;
  memberDisplayNames: string[];
  loadError?: string;
};

function normalizeMemberName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Загружает display names участников Discord-гильдии (для сверки команды). */
export async function loadDiscordTeamContext(
  guildId: string | null | undefined,
): Promise<DiscordTeamContext> {
  const gid = guildId?.trim() || null;
  if (!gid) {
    return {
      loaded: false,
      guildId: null,
      memberDisplayNames: [],
      loadError: "guild id не задан",
    };
  }

  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    return {
      loaded: false,
      guildId: gid,
      memberDisplayNames: [],
      loadError: "DISCORD_BOT_TOKEN не задан",
    };
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  try {
    await client.login(token);
    const guild = await client.guilds.fetch(gid);
    const members = await guild.members.fetch();
    const memberDisplayNames = [...members.values()].map((m) =>
      normalizeMemberName(m.displayName || m.user.username),
    );
    return { loaded: true, guildId: gid, memberDisplayNames };
  } catch (err) {
    return {
      loaded: false,
      guildId: gid,
      memberDisplayNames: [],
      loadError: err instanceof Error ? err.message : String(err),
    };
  } finally {
    client.destroy().catch(() => undefined);
  }
}

export function discordMemberMatches(
  assigneeName: string,
  memberDisplayNames: string[],
): boolean {
  const target = normalizeMemberName(assigneeName);
  if (!target) return false;

  const targetParts = target.split(/\s+/).filter((p) => p.length > 1);
  return memberDisplayNames.some((display) => {
    if (display === target) return true;
    if (display.includes(target) || target.includes(display)) return true;
    if (targetParts.length >= 2) {
      const last = targetParts[targetParts.length - 1]!;
      const first = targetParts[0]!;
      return display.includes(last) && display.includes(first);
    }
    return false;
  });
}
