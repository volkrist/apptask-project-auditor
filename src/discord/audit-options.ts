import type { CommentsAuditMode } from "../comments/comments-audit-config.js";

const COMMENTS_LIMIT_MIN = 1;
const COMMENTS_LIMIT_MAX = 300;

export function parseCommentsAuditMode(
  raw: string | null | undefined,
): CommentsAuditMode | undefined {
  if (raw === "off" || raw === "candidates" || raw === "all") return raw;
  return undefined;
}

/** Discord option имеет приоритет над COMMENTS_AUDIT_LIMIT из env. */
export function resolveCommentsAuditLimit(
  discordLimit: number | null | undefined,
  envRaw?: string,
): number | undefined {
  if (discordLimit != null && Number.isFinite(discordLimit)) {
    return clampCommentsLimit(Math.floor(discordLimit));
  }
  const env = envRaw?.trim();
  if (!env) return undefined;
  const n = Number(env);
  if (!Number.isFinite(n) || n < COMMENTS_LIMIT_MIN) return undefined;
  return clampCommentsLimit(Math.floor(n));
}

export function clampCommentsLimit(n: number): number {
  return Math.min(COMMENTS_LIMIT_MAX, Math.max(COMMENTS_LIMIT_MIN, n));
}
