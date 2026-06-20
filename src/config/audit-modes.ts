/**
 * Preset env for TurboWeave (daily), Атаев Маркет, vs full multi-board (manual /audit).
 * Mutates process.env for the current Node process only.
 */

export const TURBOWEAVE_GUILD_ID = "1481273490299555904";

/** Единый канал публикации аудита на сервере Атаев Маркет (#аудитор). */
export const ATAEV_AUDIT_DISCORD_CHANNEL_ID = "1508451205402067055";

/** @deprecated use ATAEV_AUDIT_DISCORD_CHANNEL_ID */
export const TURBOWEAVE_DISCORD_CHANNEL_ID = ATAEV_AUDIT_DISCORD_CHANNEL_ID;

export const TURBOWEAVE_AUDIT_CONFIG = {
  boardId: "783",
  boardUrl: "https://apptask.ru/c/7/board/783",
  projectName: "TurboWeave",
  discordChannelId: ATAEV_AUDIT_DISCORD_CHANNEL_ID,
  env: {
    APPTASK_COLLECTOR: "db",
    APPTASK_AUDIT_SCOPE: "multi",
    APPTASK_DB_BOARD_IDS: "783",
    APPTASK_DB_FALLBACK: "false",
    SCRUM_BOARD_IDS: "783",
    TRACKING_ESTIMATE_OVER_LIMIT_PERCENT: "20",
    AUDIT_DISCORD_CHANNEL_ID: ATAEV_AUDIT_DISCORD_CHANNEL_ID,
    AUDIT_PROFILE: "contract_turboweave_v1",
    IN_PROGRESS_STALE_BUSINESS_HOURS: "48",
    REVIEW_STALE_BUSINESS_HOURS: "24",
  },
} as const;

export const ATAEV_MARKET_AUDIT_CONFIG = {
  boardId: "789",
  boardUrl: "https://apptask.ru/c/7/board/789",
  projectName: "Атаев Маркет",
  discordChannelId: ATAEV_AUDIT_DISCORD_CHANNEL_ID,
  env: {
    APPTASK_COLLECTOR: "db",
    APPTASK_AUDIT_SCOPE: "multi",
    APPTASK_DB_BOARD_IDS: "789",
    APPTASK_DB_FALLBACK: "false",
    SCRUM_BOARD_IDS: "789",
    TRACKING_ESTIMATE_OVER_LIMIT_PERCENT: "20",
    AUDIT_DISCORD_CHANNEL_ID: ATAEV_AUDIT_DISCORD_CHANNEL_ID,
    AUDIT_PROFILE: "contract_turboweave_v1",
    IN_PROGRESS_STALE_BUSINESS_HOURS: "48",
    REVIEW_STALE_BUSINESS_HOURS: "24",
  },
} as const;

/** Доски полного multi-board аудита (/audit, audit:full). */
export const FULL_AUDIT_BOARD_IDS = ["783", "445", "54", "789"] as const;

export const FULL_AUDIT_CONFIG = {
  boardUrl: "https://apptask.ru/c/7/board/783",
  projectName: "AppTask Multi-Board",
  boardIds: FULL_AUDIT_BOARD_IDS,
  env: {
    APPTASK_COLLECTOR: "db",
    APPTASK_AUDIT_SCOPE: "multi",
    APPTASK_DB_BOARD_IDS: FULL_AUDIT_BOARD_IDS.join(","),
    APPTASK_DB_FALLBACK: "false",
    SCRUM_BOARD_IDS: "783",
    AUDIT_DISCORD_CHANNEL_ID: ATAEV_AUDIT_DISCORD_CHANNEL_ID,
    AUDIT_PROFILE: "contract_turboweave_v1",
    IN_PROGRESS_STALE_BUSINESS_HOURS: "48",
    REVIEW_STALE_BUSINESS_HOURS: "24",
  },
} as const;

export type AuditModePreset = "turboweave" | "ataev_market" | "full";

const PRESETS: Record<AuditModePreset, Record<string, string>> = {
  turboweave: { ...TURBOWEAVE_AUDIT_CONFIG.env },
  ataev_market: { ...ATAEV_MARKET_AUDIT_CONFIG.env },
  full: { ...FULL_AUDIT_CONFIG.env },
};

/** @returns snapshot of previous env values for restoreAuditModeEnv */
export function applyAuditModeEnv(mode: AuditModePreset): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(PRESETS[mode])) {
    snapshot[key] = process.env[key];
    process.env[key] = value;
  }
  return snapshot;
}

export function restoreAuditModeEnv(
  snapshot: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export function describeAuditMode(mode: AuditModePreset): string {
  if (mode === "turboweave") {
    return `TurboWeave — board ${TURBOWEAVE_AUDIT_CONFIG.boardId} only`;
  }
  if (mode === "ataev_market") {
    return `Атаев Маркет — board ${ATAEV_MARKET_AUDIT_CONFIG.boardId} only`;
  }
  return `Full — boards ${FULL_AUDIT_CONFIG.boardIds.join(", ")}`;
}

export function projectNameForAuditMode(mode: AuditModePreset): string {
  if (mode === "turboweave") return TURBOWEAVE_AUDIT_CONFIG.projectName;
  if (mode === "ataev_market") return ATAEV_MARKET_AUDIT_CONFIG.projectName;
  return FULL_AUDIT_CONFIG.projectName;
}

export function boardUrlForAuditMode(mode: AuditModePreset): string {
  if (mode === "turboweave") return TURBOWEAVE_AUDIT_CONFIG.boardUrl;
  if (mode === "ataev_market") return ATAEV_MARKET_AUDIT_CONFIG.boardUrl;
  return FULL_AUDIT_CONFIG.boardUrl;
}
