import type { Rule, RuleContext, RuleResult } from "../rule-types.js";
import {
  isCompletedStatus,
  isInProgressStatus,
  isReviewStatus,
} from "../status/status-helpers.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import { pass, warn, fail } from "../helpers.js";

function scrumNotLoaded(ruleId: string): RuleResult {
  return pass(ruleId, "Scrum-смета не загружена (SKIP)");
}

function requireScrum(ctx: RuleContext, ruleId: string): RuleResult | null {
  if (!ctx.scrum?.loaded) {
    return scrumNotLoaded(ruleId);
  }
  return null;
}

const inWorkStatuses = (status: string | null): boolean =>
  isInProgressStatus(status) || isReviewStatus(status);

export const taskInApprovedEstimateRule: Rule = {
  id: "scrum_task_in_estimate",
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, "scrum_task_in_estimate");
    if (skip) return skip;
    if (!inWorkStatuses(task.status) && !isCompletedStatus(task.status)) {
      return pass("scrum_task_in_estimate", "Задача не в активной работе");
    }
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind === "ok") {
      return pass("scrum_task_in_estimate", "Найдена в смете");
    }
    const disclaimer = ctx.scrum!.config.matchDisclaimer;
    if (match.kind === "code_title_mismatch") {
      return warn(
        "scrum_task_in_estimate",
        `Код совпал, название отличается от сметы. ${disclaimer}`,
      );
    }
    if (match.kind === "similar_title") {
      return warn(
        "scrum_task_in_estimate",
        `Похожая строка в смете, нужна ручная проверка. ${disclaimer}`,
      );
    }
    return fail(
      "scrum_task_in_estimate",
      `Задача не найдена в смете по текущей логике сопоставления. ${disclaimer}`,
    );
  },
};

export const scrumTitleMatchesEstimateRule: Rule = {
  id: "scrum_title_matches_estimate",
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, "scrum_title_matches_estimate");
    if (skip) return skip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind === "code_title_mismatch") {
      return warn(
        "scrum_title_matches_estimate",
        `Название задачи не совпадает со сметой (код ${match.row.code})`,
      );
    }
    return pass("scrum_title_matches_estimate", "OK");
  },
};

export const scrumPlannedHoursInPortalRule: Rule = {
  id: "scrum_planned_hours_present",
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, "scrum_planned_hours_present");
    if (skip) return skip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind !== "ok") {
      return pass("scrum_planned_hours_present", "Нет строки сметы для проверки ПВ");
    }
    if (match.row.plannedHours == null || match.row.plannedHours <= 0) {
      return warn(
        "scrum_planned_hours_present",
        `ПВ (${ctx.scrum!.config.plannedHoursColumn}) не указано в Scrum-портале`,
      );
    }
    return pass("scrum_planned_hours_present", "ПВ указано");
  },
};

export const scrumDecompositionOver20hRule: Rule = {
  id: "scrum_decomposition_over_20h",
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, "scrum_decomposition_over_20h");
    if (skip) return skip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind !== "ok") {
      return pass("scrum_decomposition_over_20h", "Нет строки сметы");
    }
    const hours =
      match.row.estimateHours ?? match.row.plannedHours ?? null;
    const threshold = ctx.scrum!.config.decompositionHoursThreshold;
    if (hours != null && hours > threshold && !match.row.subTask?.trim()) {
      return warn(
        "scrum_decomposition_over_20h",
        `В смете ${hours} ч (> ${threshold}) без подзадач/декомпозиции`,
      );
    }
    return pass("scrum_decomposition_over_20h", "OK");
  },
};

export const scrumBoardRules: Rule[] = [
  taskInApprovedEstimateRule,
  scrumTitleMatchesEstimateRule,
  scrumPlannedHoursInPortalRule,
  scrumDecompositionOver20hRule,
];
