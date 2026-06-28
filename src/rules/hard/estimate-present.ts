import type { AuditConfig } from "../../config/audit-config.js";
import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule } from "../rule-types.js";
import type { RuleContext } from "../rule-types.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import {
  collectLinkTargets,
  descriptionMatchesPatterns,
  fail,
  isBlank,
  matchesAnyPattern,
  pass,
} from "../helpers.js";

function hasPlannedTime(task: RawTask, config: AuditConfig): boolean {
  const planned = task.plannedTime?.trim() ?? "";
  return (
    !isBlank(planned) &&
    !(config.emptyPlannedTimeValues as readonly string[]).includes(planned)
  );
}

function hasEstimateInDescription(task: RawTask, config: AuditConfig): boolean {
  if (descriptionMatchesPatterns(task.descriptionText, config.estimateTextPatterns)) {
    return true;
  }
  const targets = collectLinkTargets(task);
  const textBlob = [task.descriptionText ?? "", ...targets].join("\n");
  return matchesAnyPattern([textBlob], config.estimateLinkPatterns);
}

function hasScrumPv(task: RawTask, ctx?: RuleContext): boolean {
  if (!ctx?.scrum?.loaded || !ctx.scrum.rows?.length) return false;
  const match = matchTaskToEstimate(task, ctx.scrum.rows);
  if (match.kind === "not_found") return false;
  const hours = match.row.estimateHours ?? match.row.plannedHours;
  return hours != null && Number.isFinite(hours) && hours > 0;
}

/** ПВ в карточке, упоминание/ссылка на смету в описании, или ПВ в Google-смете. */
export function taskHasEstimatePresent(
  task: RawTask,
  config: AuditConfig,
  ctx?: RuleContext,
): boolean {
  return (
    hasPlannedTime(task, config) ||
    hasEstimateInDescription(task, config) ||
    hasScrumPv(task, ctx)
  );
}

export const estimatePresentRule: Rule = {
  id: "estimate_present",
  severity: "hard",
  evaluate(task, ctx) {
    if (taskHasEstimatePresent(task, ctx.config, ctx)) {
      return pass("estimate_present");
    }

    return fail(
      "estimate_present",
      "Не указано плановое время (ПВ) в карточке, нет ссылки/упоминания сметы в описании и нет ПВ в Google-смете",
    );
  },
};
