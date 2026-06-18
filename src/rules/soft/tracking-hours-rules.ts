import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule, RuleContext, RuleResult } from "../rule-types.js";
import { commentPlainTextForRules } from "../helpers.js";
import { pass, warn, skip } from "../helpers.js";
import {
  isCompletedStatus,
  isInProgressStatus,
  isReviewStatus,
} from "../status/status-helpers.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import {
  getTaskTrackingMetrics,
  type TrackingAuditContext,
} from "../../tracking/load-tracking-context.js";
import {
  isTrackingEstimateBoard,
  loadTrackingHoursConfig,
  type TrackingHoursConfig,
} from "../../tracking/tracking-hours-config.js";
import type { TaskTrackingHours } from "../../tracking/tracking-hours-reader.js";

export const DONE_WITHOUT_TRACKING_RULE = "done_task_without_tracking";
export const IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE =
  "in_progress_without_recent_tracking";
export const ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE = "actual_hours_exceeds_estimate";
export const ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE =
  "estimate_exceeded_without_comment";
export const TRACKING_ON_NON_WORK_STATUS_RULE = "tracking_on_non_work_status";

export const TRACKING_HOURS_RULE_IDS = new Set([
  DONE_WITHOUT_TRACKING_RULE,
  IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
  ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
  ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
  TRACKING_ON_NON_WORK_STATUS_RULE,
]);

function trackingSkip(ruleId: string, reason: string): RuleResult {
  return skip(ruleId, reason);
}

function requireTracking(
  ctx: RuleContext,
  ruleId: string,
): TrackingAuditContext | RuleResult {
  if (!ctx.tracking?.loaded) {
    const reason = ctx.tracking?.loadError ?? "tracking DB недоступен";
    return trackingSkip(ruleId, reason);
  }
  return ctx.tracking;
}

function metricsForTask(
  ctx: RuleContext,
  task: RawTask,
): TaskTrackingHours | null {
  if (!ctx.tracking?.loaded) return null;
  return getTaskTrackingMetrics(ctx.tracking, task);
}

function actualHoursOf(metrics: TaskTrackingHours | null): number {
  return metrics?.actualHours ?? 0;
}

function estimateHoursForTask(
  task: RawTask,
  ctx: RuleContext,
): number | null {
  if (!ctx.scrum?.loaded) return null;
  const match = matchTaskToEstimate(task, ctx.scrum.rows);
  if (match.kind !== "ok" && match.kind !== "title_mismatch") return null;
  const hours = match.row.estimateHours ?? match.row.plannedHours;
  return hours != null && hours > 0 ? hours : null;
}

function overrunPercent(
  actualHours: number,
  estimateHours: number,
): number {
  if (estimateHours <= 0) return 0;
  return ((actualHours - estimateHours) / estimateHours) * 100;
}

function limitMultiplier(config: TrackingHoursConfig): number {
  return 1 + config.estimateOverLimitPercent / 100;
}

function hasExplanationComment(
  task: RawTask,
  markers: readonly string[],
): boolean {
  for (const c of task.comments ?? []) {
    const text = commentPlainTextForRules(c).toLowerCase();
    if (!text) continue;
    if (markers.some((m) => text.includes(m.toLowerCase()))) return true;
  }
  return false;
}

function requireEstimateBoard(
  task: RawTask,
  ctx: RuleContext,
  ruleId: string,
): RuleResult | null {
  const trackingConfig =
    ctx.tracking?.config ?? loadTrackingHoursConfig();

  if (!isTrackingEstimateBoard(task.boardId, trackingConfig)) {
    return trackingSkip(
      ruleId,
      `compare ПВ только для board ${trackingConfig.estimateBoardIds.join(", ")}`,
    );
  }
  if (!ctx.scrum?.loaded) {
    return trackingSkip(
      ruleId,
      ctx.scrum?.loadError ?? "Scrum/смета не загружена",
    );
  }
  return null;
}

export const doneTaskWithoutTrackingRule: Rule = {
  id: DONE_WITHOUT_TRACKING_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const tracking = requireTracking(ctx, DONE_WITHOUT_TRACKING_RULE);
    if ("ruleId" in tracking) return tracking;
    if (!isCompletedStatus(task.status)) {
      return pass(DONE_WITHOUT_TRACKING_RULE, "Задача не в завершённом статусе");
    }
    const hours = actualHoursOf(metricsForTask(ctx, task));
    if (hours > 0.001) {
      return pass(DONE_WITHOUT_TRACKING_RULE, `Факт: ${hours.toFixed(2)} ч`);
    }
    return warn(
      DONE_WITHOUT_TRACKING_RULE,
      "Задача завершена, но фактическое время = 0 ч",
    );
  },
};

export const inProgressWithoutRecentTrackingRule: Rule = {
  id: IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const tracking = requireTracking(ctx, IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE);
    if ("ruleId" in tracking) return tracking;
    if (!isInProgressStatus(task.status)) {
      return pass(IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE, "Не в работе");
    }
    const metrics = metricsForTask(ctx, task);
    if (metrics?.hasTrackingInLastBusinessDay) {
      return pass(
        IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
        "Есть трекинг за последний раб. день",
      );
    }
    return warn(
      IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
      `Нет трекинга за последний рабочий день (last: ${metrics?.lastTrackingDate ?? "—"})`,
    );
  },
};

export const actualHoursExceedsEstimateRule: Rule = {
  id: ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const tracking = requireTracking(ctx, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
    if ("ruleId" in tracking) return tracking;
    const boardSkip = requireEstimateBoard(
      task,
      ctx,
      ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
    );
    if (boardSkip) return boardSkip;

    const estimateHours = estimateHoursForTask(task, ctx);
    if (estimateHours == null) {
      return pass(
        ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
        "Нет ПВ в Scrum для сравнения",
      );
    }

    const actual = actualHoursOf(metricsForTask(ctx, task));
    const limit = tracking.config.estimateOverLimitPercent;
    const threshold = estimateHours * limitMultiplier(tracking.config);
    const overrun = overrunPercent(actual, estimateHours);

    if (actual <= threshold) {
      return pass(
        ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
        `Факт ${actual.toFixed(2)} ч ≤ ПВ ${estimateHours} ч (+${limit}%)`,
      );
    }
    return warn(
      ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
      `Факт ${actual.toFixed(2)} ч > ПВ ${estimateHours} ч (+${limit}%) — перерасход ${overrun.toFixed(1)}%`,
    );
  },
};

export const estimateExceededWithoutCommentRule: Rule = {
  id: ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const tracking = requireTracking(ctx, ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE);
    if ("ruleId" in tracking) return tracking;
    const boardSkip = requireEstimateBoard(
      task,
      ctx,
      ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
    );
    if (boardSkip) return boardSkip;

    const estimateHours = estimateHoursForTask(task, ctx);
    if (estimateHours == null) {
      return pass(ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE, "Нет ПВ");
    }

    const actual = actualHoursOf(metricsForTask(ctx, task));
    const limit = tracking.config.estimateOverLimitPercent;
    if (actual <= estimateHours * limitMultiplier(tracking.config)) {
      return pass(
        ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
        "Перерасход ниже порога",
      );
    }

    if (hasExplanationComment(task, tracking.config.explanationMarkers)) {
      return pass(
        ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
        "Есть комментарий с объяснением перерасхода",
      );
    }
    return warn(
      ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
      `Перерасход > ${limit}% без объясняющего комментария`,
    );
  },
};

export const trackingOnNonWorkStatusRule: Rule = {
  id: TRACKING_ON_NON_WORK_STATUS_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const tracking = requireTracking(ctx, TRACKING_ON_NON_WORK_STATUS_RULE);
    if ("ruleId" in tracking) return tracking;
    const metrics = metricsForTask(ctx, task);
    if (!metrics?.hasTrackingInLast24Hours) {
      return pass(TRACKING_ON_NON_WORK_STATUS_RULE, "Нет трекинга за 24 ч");
    }
    if (isInProgressStatus(task.status) || isReviewStatus(task.status)) {
      return pass(
        TRACKING_ON_NON_WORK_STATUS_RULE,
        "Статус рабочий или на проверке",
      );
    }
    return warn(
      TRACKING_ON_NON_WORK_STATUS_RULE,
      `Трекинг за 24 ч при статусе «${task.status ?? "—"}» (не в работе/проверке)`,
    );
  },
};

export const trackingHoursRules: Rule[] = [
  doneTaskWithoutTrackingRule,
  inProgressWithoutRecentTrackingRule,
  actualHoursExceedsEstimateRule,
  estimateExceededWithoutCommentRule,
  trackingOnNonWorkStatusRule,
];

export {
  overrunPercent,
  hasExplanationComment,
  estimateHoursForTask,
};
