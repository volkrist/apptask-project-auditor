import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule, RuleContext, RuleResult } from "../rule-types.js";
import {
  isCompletedStatus,
  isInProgressStatus,
  isReviewStatus,
} from "../status/status-helpers.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import { isScrumAuditBoard } from "../../scrum/scrum-estimate-config.js";
import { parsePlannedTimeHours, pass, warn, skip } from "../helpers.js";

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

function scrumSkip(ruleId: string, reason: string): RuleResult {
  return pass(ruleId, `${reason} (SKIP)`);
}

function requireScrumBoard(
  task: RawTask,
  ctx: RuleContext,
  ruleId: string,
): RuleResult | null {
  const config = ctx.scrum?.config;
  if (!config) {
    return scrumSkip(ruleId, "Google Sheets не настроен — правило пропущено");
  }
  if (!isScrumAuditBoard(task.boardId, config)) {
    const boardLabel = task.boardId ?? "unknown";
    const allowed = config.scrumBoardIds.join(", ");
    return scrumSkip(
      ruleId,
      `Scrum/смета только для board ${allowed}, текущая доска ${boardLabel}`,
    );
  }
  return null;
}

function requireScrum(ctx: RuleContext, ruleId: string): RuleResult | null {
  if (!ctx.scrum?.loaded) {
    const reason = ctx.scrum?.loadError ?? "смета не загружена";
    return scrumSkip(ruleId, `Google Sheets недоступен: ${reason}`);
  }
  return null;
}

function requireScrumForTask(
  task: RawTask,
  ctx: RuleContext,
  ruleId: string,
): RuleResult | null {
  const boardSkip = requireScrumBoard(task, ctx, ruleId);
  if (boardSkip) return boardSkip;
  return requireScrum(ctx, ruleId);
}

const inWorkStatuses = (status: string | null): boolean =>
  isInProgressStatus(status) || isReviewStatus(status);

const NOT_IN_ESTIMATE_MSG =
  "Задача не найдена в утверждённой смете по текущей логике сопоставления";

export const taskInApprovedEstimateRule: Rule = {
  id: SCRUM_ESTIMATE_MISSING_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrumForTask(task, ctx, SCRUM_ESTIMATE_MISSING_RULE);
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
    return warn(SCRUM_ESTIMATE_MISSING_RULE, NOT_IN_ESTIMATE_MSG);
  },
};

export const scrumTitleMatchesEstimateRule: Rule = {
  id: SCRUM_NAME_MISMATCH_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const boardSkip = requireScrumForTask(task, ctx, SCRUM_NAME_MISMATCH_RULE);
    if (boardSkip) return boardSkip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind === "not_found") {
      return skip(
        SCRUM_NAME_MISMATCH_RULE,
        "Нет строки сметы — сверка названия не выполнялась",
      );
    }
    if (match.kind === "title_mismatch") {
      return warn(
        SCRUM_NAME_MISMATCH_RULE,
        `AppTask: «${match.taskTitle}» ≠ смета: «${match.estimateTitle}»`,
      );
    }
    return pass(
      SCRUM_NAME_MISMATCH_RULE,
      "Название совпадает со строкой сметы",
    );
  },
};

export const scrumPlannedHoursInPortalRule: Rule = {
  id: SCRUM_PV_MISSING_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const boardSkip = requireScrumForTask(task, ctx, SCRUM_PV_MISSING_RULE);
    if (boardSkip) return boardSkip;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);
    if (match.kind !== "ok" && match.kind !== "title_mismatch") {
      return skip(
        SCRUM_PV_MISSING_RULE,
        "Нет строки сметы — ПВ не проверялось",
      );
    }
    const row = match.row;
    const col = ctx.scrum!.config.pvColumn;
    const hours = row.estimateHours ?? row.plannedHours;
    if (hours == null || hours <= 0) {
      return warn(
        SCRUM_PV_MISSING_RULE,
        `ПВ («${col}») не указано для «${row.fullTitle || row.title}»`,
      );
    }
    return pass(SCRUM_PV_MISSING_RULE, "ПВ указано");
  },
};

export const scrumDecompositionOver20hRule: Rule = {
  id: SCRUM_DECOMPOSITION_RULE,
  severity: "soft",
  evaluate(task, ctx) {
    const skip = requireScrumForTask(task, ctx, SCRUM_DECOMPOSITION_RULE);
    if (skip) return skip;
    const threshold = ctx.scrum!.config.decompositionHoursThreshold;
    const match = matchTaskToEstimate(task, ctx.scrum!.rows);

    if (match.kind === "ok" || match.kind === "title_mismatch") {
      const row = match.row;
      const hours = row.estimateHours ?? row.plannedHours ?? null;
      const hasSubTasks = Boolean(
        row.subtaskTitle?.trim() || row.subTask?.trim(),
      );
      if (hours != null && hours > threshold && !hasSubTasks) {
        return warn(
          SCRUM_DECOMPOSITION_RULE,
          `В Scrum ${hours} ч (> ${threshold}) без подзадач/декомпозиции («${row.fullTitle || row.title}»)`,
        );
      }
      return pass(SCRUM_DECOMPOSITION_RULE, "OK");
    }

    const cardHours = parsePlannedTimeHours(task.plannedTime);
    if (cardHours != null && cardHours > threshold) {
      return warn(
        SCRUM_DECOMPOSITION_RULE,
        `ПВ ${cardHours} ч в карточке AppTask (> ${threshold}), задача не найдена в смете — декомпозиция не подтверждена`,
      );
    }

    return pass(SCRUM_DECOMPOSITION_RULE, "Нет строки сметы");
  },
};

export const scrumBoardRules: Rule[] = [
  taskInApprovedEstimateRule,
  scrumTitleMatchesEstimateRule,
  scrumPlannedHoursInPortalRule,
  scrumDecompositionOver20hRule,
];
