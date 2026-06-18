/**
 * Preset env for TurboWeave (daily) vs full multi-board (manual /audit).
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

export const FULL_AUDIT_CONFIG = {
  boardUrl: "https://apptask.ru/c/7/board/783",
  projectName: "AppTask Multi-Board",
  boardIds: ["783", "445", "54"] as const,
  env: {
    APPTASK_COLLECTOR: "db",
    APPTASK_AUDIT_SCOPE: "multi",
    APPTASK_DB_BOARD_IDS: "783,445,54",
    APPTASK_DB_FALLBACK: "false",
    SCRUM_BOARD_IDS: "783",
    AUDIT_DISCORD_CHANNEL_ID: ATAEV_AUDIT_DISCORD_CHANNEL_ID,
    AUDIT_PROFILE: "contract_turboweave_v1",
    IN_PROGRESS_STALE_BUSINESS_HOURS: "48",
    REVIEW_STALE_BUSINESS_HOURS: "24",
  },
} as const;

export type AuditModePreset = "turboweave" | "full";

const PRESETS: Record<AuditModePreset, Record<string, string>> = {
  turboweave: { ...TURBOWEAVE_AUDIT_CONFIG.env },
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
  return `Full — boards ${FULL_AUDIT_CONFIG.boardIds.join(", ")}`;
}
