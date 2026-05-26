import {
  ApplicationCommandOptionType,
  ChannelType,
} from "discord.js";

/** Guild slash commands — PUT полностью заменяет команды гильдии (старые /audit, /comments исчезнут). */
export const slashCommands = [
  {
    name: "audit_full",
    description: "Полная проверка карточек по правилам (без комментариев)",
    options: [
      {
        name: "board_url",
        description: "URL доски AppTask (без указания — APPTASK_BOARD_URL из .env)",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: "audit_limit",
    description: "Проверка N карточек по правилам (без комментариев)",
    options: [
      {
        name: "limit",
        description: "Сколько карточек проверить",
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
        max_value: 500,
      },
      {
        name: "board_url",
        description: "URL доски AppTask (без указания — APPTASK_BOARD_URL из .env)",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: "comments_full",
    description: "Полная проверка комментариев на доске (без аудита карточек)",
    options: [
      {
        name: "board_url",
        description:
          "URL доски (без указания — APPTASK_COMMENTS_BOARD_URL из .env)",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: "comments_limit",
    description: "Проверка комментариев у N задач (без аудита карточек)",
    options: [
      {
        name: "limit",
        description: "Сколько задач проверить",
        type: ApplicationCommandOptionType.Integer,
        required: true,
        min_value: 1,
        max_value: 500,
      },
      {
        name: "board_url",
        description:
          "URL доски (без указания — APPTASK_COMMENTS_BOARD_URL из .env)",
        type: ApplicationCommandOptionType.String,
        required: false,
      },
    ],
  },
  {
    name: "project_add",
    description: "Save AppTask board → Discord channel mapping",
    options: [
      {
        name: "name",
        description: "Project name",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "board_url",
        description: "AppTask board URL",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: "channel",
        description: "Discord channel for audit reports",
        type: ApplicationCommandOptionType.Channel,
        required: true,
        channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      },
    ],
  },
  {
    name: "project_list",
    description: "List saved board → channel mappings",
  },
  {
    name: "project_remove",
    description: "Remove a saved project mapping",
    options: [
      {
        name: "name",
        description: "Project name or id",
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
] as const;

export const AUDIT_SLASH_COMMANDS = ["audit_full", "audit_limit"] as const;
export const COMMENTS_SLASH_COMMANDS = ["comments_full", "comments_limit"] as const;

/** Устаревшие имена, которые Discord может показывать до синхронизации slash-команд. */
export const LEGACY_AUDIT_COMMANDS = ["audit"] as const;
export const LEGACY_COMMENTS_COMMANDS = ["comments"] as const;

/** Активные long-running команды (без legacy — те только deprecation-ответ). */
export const LONG_RUNNING_SLASH_COMMANDS = [
  ...AUDIT_SLASH_COMMANDS,
  ...COMMENTS_SLASH_COMMANDS,
] as const;

export const LEGACY_AUDIT_DEPRECATION_MESSAGE = [
  "Команда /audit устарела. Используйте:",
  "• /audit_full — полная проверка карточек",
  "• /audit_limit — проверка карточек с лимитом",
].join("\n");

export const LEGACY_COMMENTS_DEPRECATION_MESSAGE = [
  "Команда /comments устарела. Используйте:",
  "• /comments_full — полная проверка комментариев",
  "• /comments_limit — проверка комментариев с лимитом",
].join("\n");

export const UNKNOWN_COMMAND_MESSAGE =
  "Команда не поддерживается. Доступные команды: /audit_full, /audit_limit, /comments_full, /comments_limit";

const PROJECT_SLASH_COMMANDS = [
  "project_add",
  "project_list",
  "project_remove",
] as const;

export function isProjectSlashCommand(name: string): boolean {
  return (PROJECT_SLASH_COMMANDS as readonly string[]).includes(name);
}

export function isLongRunningSlashCommand(name: string): boolean {
  return (LONG_RUNNING_SLASH_COMMANDS as readonly string[]).includes(name);
}

export function isLegacyAuditSlashCommand(name: string): boolean {
  return (LEGACY_AUDIT_COMMANDS as readonly string[]).includes(name);
}

export function isLegacyCommentsSlashCommand(name: string): boolean {
  return (LEGACY_COMMENTS_COMMANDS as readonly string[]).includes(name);
}

export function getCommandOptionNames(commandName: string): string[] {
  const cmd = slashCommands.find((c) => c.name === commandName);
  if (!cmd || !("options" in cmd) || !cmd.options) return [];
  return cmd.options.map((o) => o.name);
}

export function formatSlashCommandsForLog(): string {
  return slashCommands.map((c) => `/${c.name}`).join(", ");
}

/** Лог при замене guild-команд: только аудит и комментарии (без project_*). */
export function formatAuditCommentsSlashCommandsForLog(): string {
  return [...AUDIT_SLASH_COMMANDS, ...COMMENTS_SLASH_COMMANDS]
    .map((name) => `/${name}`)
    .join(", ");
}

export function formatRegisteredCommandsDetail(): string[] {
  return slashCommands.map((c) => {
    const opts = getCommandOptionNames(c.name);
    return `command=/${c.name} options=${opts.length > 0 ? opts.join(",") : "(none)"}`;
  });
}
