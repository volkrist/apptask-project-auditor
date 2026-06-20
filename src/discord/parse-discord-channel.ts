/** Извлекает ID Discord-канала из ссылки AppTask (Boards.discord_link) или сырого snowflake. */
export function parseDiscordChannelRef(
  raw: string | null | undefined,
): string | null {
  const text = raw?.trim();
  if (!text) return null;

  const channelPath = text.match(
    /discord(?:app)?\.com\/channels\/\d+\/(\d{17,20})/i,
  );
  if (channelPath?.[1]) return channelPath[1];

  if (/^\d{17,20}$/.test(text)) return text;

  return null;
}
