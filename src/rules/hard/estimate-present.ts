import type { AuditConfig } from "../../config/audit-config.js";
import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule } from "../rule-types.js";
import type { RuleContext } from "../rule-types.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import {
  collectLinkTargets,
  descriptionMatchesPatterns,
  fail,
  matchesAnyPattern,
  pass,
} from "../helpers.js";

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

/**
 * Оценка «по смете»: упоминание/ссылка на смету или бюджет в карточке,
 * либо ПВ > 0 в Google-смете. Поле «Примерное время» в AppTask само по себе не засчитывается
 * (см. estimate_link_present для обязательной ссылки на смету).
 */
export function taskHasEstimatePresent(
  task: RawTask,
  config: AuditConfig,
  ctx?: RuleContext,
): boolean {
  return hasEstimateInDescription(task, config) || hasScrumPv(task, ctx);
}

export const estimatePresentRule: Rule = {
  id: "estimate_present",
  severity: "hard",
  evaluate(task, ctx) {
    if (taskHasEstimatePresent(task, ctx.config, ctx)) {
      return pass("estimate_present");
    }

    const pv = task.plannedTime?.trim();
    const pvNote =
      pv && pv !== "00:00"
        ? ` Поле «Примерное время» (${pv}) без сметы не засчитывается.`
        : "";

    return fail(
      "estimate_present",
      "Нет упоминания сметы/бюджета в описании и нет ПВ в Google-смете для этой задачи." +
        pvNote,
    );
  },
};
