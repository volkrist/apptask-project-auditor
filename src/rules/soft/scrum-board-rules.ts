import type { Rule, RuleContext, RuleResult } from "../rule-types.js";
import {
  isCompletedStatus,
  isInProgressStatus,
  isReviewStatus,
} from "../status/status-helpers.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import { pass, warn, fail } from "../helpers.js";

export const SCRUM_ESTIMATE_MISSING_RULE = "scrum_task_in_estimate";
export const SCRUM_NAME_MISMATCH_RULE = "scrum_title_matches_estimate";
export const SCRUM_PV_MISSING_RULE = "scrum_planned_hours_present";
export const SCRUM_DECOMPOSITION_RULE = "scrum_decomposition_over_20h";

export const SCRUM_RULE_IDS = new Set([
  SCRUM_ESTIMATE_MISSING_RULE,
  SCRUM_NAME_MISMATCH_RULE,
  SCRUM_PV_MISSING_RULE,
  SCRUM_DECOMPOSITION_RULE,
]);

function scrumSkip(ruleId: string, ctx: RuleContext): RuleResult {
  if (!ctx.scrum) {
    return pass(
      ruleId,
      "Google Sheets не настроен — правило пропущено (SKIP)",
    );
  }
  const reason = ctx.scrum.loadError ?? "смета не загружена";
  return pass(ruleId, `Google Sheets недоступен: ${reason} (SKIP)`);
}

function requireScrum(ctx: RuleContext, ruleId: string): RuleResult | null {
  if (!ctx.scrum?.loaded) {
    return scrumSkip(ruleId, ctx);
  }
  return null;
}

const inWorkStatuses = (status: string | null): boolean =>
  isInProgressStatus(status) || isReviewStatus(status);

const NOT_IN_ESTIMATE_MSG =
  "Задача не найдена в утверждённой смете по текущей логике сопоставления";

export const taskInApprovedEstimateRule: Rule = {
  id: SCRUM_ESTIMATE_MISSING_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, SCRUM_ESTIMATE_MISSING_RULE);
    if (skip) return skip;
    if (!inWorkStatuses(task.status) && !isCompletedStatus(task.status)) {
      return pass(SCRUM_ESTIMATE_MISSING_RULE, "Задача не в активной работе");
    }
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind === "ok") {
      return pass(SCRUM_ESTIMATE_MISSING_RULE, "Найдена в утверждённой смете");
    }
    if (match.kind === "title_mismatch") {
      return pass(
        SCRUM_ESTIMATE_MISSING_RULE,
        "Найдена по названию (есть расхождение — см. scrum_title_matches_estimate)",
      );
    }
    return fail(SCRUM_ESTIMATE_MISSING_RULE, NOT_IN_ESTIMATE_MSG);
  },
};

export const scrumTitleMatchesEstimateRule: Rule = {
  id: SCRUM_NAME_MISMATCH_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, SCRUM_NAME_MISMATCH_RULE);
    if (skip) return skip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind === "title_mismatch") {
      return warn(
        SCRUM_NAME_MISMATCH_RULE,
        `AppTask: «${match.taskTitle}» ≠ смета: «${match.estimateTitle}»`,
      );
    }
    return pass(SCRUM_NAME_MISMATCH_RULE, "OK");
  },
};

export const scrumPlannedHoursInPortalRule: Rule = {
  id: SCRUM_PV_MISSING_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, SCRUM_PV_MISSING_RULE);
    if (skip) return skip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind !== "ok" && match.kind !== "title_mismatch") {
      return pass(SCRUM_PV_MISSING_RULE, "Нет строки сметы для проверки ПВ");
    }
    const row = match.row;
    const col = ctx.scrum!.config.pvColumn;
    if (row.plannedHours == null || row.plannedHours <= 0) {
      return warn(
        SCRUM_PV_MISSING_RULE,
        `ПВ («${col}») не указано в смете для задачи «${row.title}»`,
      );
    }
    return pass(SCRUM_PV_MISSING_RULE, "ПВ указано");
  },
};

export const scrumDecompositionOver20hRule: Rule = {
  id: SCRUM_DECOMPOSITION_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrum(ctx, SCRUM_DECOMPOSITION_RULE);
    if (skip) return skip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind !== "ok" && match.kind !== "title_mismatch") {
      return pass(SCRUM_DECOMPOSITION_RULE, "Нет строки сметы");
    }
    const row = match.row;
    const hours = row.plannedHours ?? row.estimateHours ?? null;
    const threshold = ctx.scrum!.config.decompositionHoursThreshold;
    const hasSubTasks = Boolean(row.subTask?.trim());
    if (hours != null && hours > threshold && !hasSubTasks) {
      return warn(
        SCRUM_DECOMPOSITION_RULE,
        `В смете ${hours} ч (> ${threshold}) без подзадач/декомпозиции («${row.title}»)`,
      );
    }
    return pass(SCRUM_DECOMPOSITION_RULE, "OK");
  },
};

export const scrumBoardRules: Rule[] = [
  taskInApprovedEstimateRule,
  scrumTitleMatchesEstimateRule,
  scrumPlannedHoursInPortalRule,
  scrumDecompositionOver20hRule,
];
