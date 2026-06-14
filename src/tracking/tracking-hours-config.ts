import { parseScrumBoardIdsFromEnv } from "../scrum/scrum-estimate-config.js";

export type TrackingHoursConfig = {
  /** Превышение ПВ для WARN, % (env TRACKING_ESTIMATE_OVER_LIMIT_PERCENT, default 20). */
  estimateOverLimitPercent: number;
  /** Доски с compare actual vs Scrum ПВ (default SCRUM board ids). */
  estimateBoardIds: number[];
  explanationMarkers: readonly string[];
};

export const DEFAULT_TRACKING_EXPLANATION_MARKERS = [
  "превысили",
  "перерасход",
  "заняло больше",
  "сложнее",
  "не учли",
  "дополнительное время",
  "проблема",
  "блокер",
  "переделка",
  "баг",
  "правки",
] as const;

export function parseEstimateOverLimitPercent(
  raw = process.env.TRACKING_ESTIMATE_OVER_LIMIT_PERCENT,
): number {
  const n = Number(raw ?? "20");
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(n, 500);
}

export function loadTrackingHoursConfig(): TrackingHoursConfig {
  const estimateBoardIds = parseScrumBoardIdsFromEnv()
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  return {
    estimateOverLimitPercent: parseEstimateOverLimitPercent(),
    estimateBoardIds,
    explanationMarkers: DEFAULT_TRACKING_EXPLANATION_MARKERS,
  };
}

export function isTrackingEstimateBoard(
  boardId: string | null | undefined,
  config: TrackingHoursConfig = loadTrackingHoursConfig(),
): boolean {
  if (!boardId?.trim()) return false;
  const id = Number(boardId);
  return Number.isFinite(id) && config.estimateBoardIds.includes(id);
}
