import type { AuditConfig } from "../../config/audit-config.js";
import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule } from "../rule-types.js";
import type { RuleContext } from "../rule-types.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import { collectLinkTargets, fail, matchesAnyPattern, pass } from "../helpers.js";

const ESTIMATE_LINK_HINT =
  "смета, договор, заявка, согласование, Google Sheets (spreadsheets)";

function hasEstimateLinkInCard(task: RawTask, config: AuditConfig): boolean {
  const targets = collectLinkTargets(task);
  const textBlob = [task.descriptionText ?? "", ...targets].join("\n");
  return matchesAnyPattern([textBlob], config.estimateLinkPatterns);
}

function hasScrumEstimateRow(task: RawTask, ctx?: RuleContext): boolean {
  if (!ctx?.scrum?.loaded || !ctx.scrum.rows?.length) return false;
  return matchTaskToEstimate(task, ctx.scrum.rows).kind !== "not_found";
}

/** Связь со сметой: URL/текст в карточке или строка в Google-смете. */
export function taskHasEstimateLink(
  task: RawTask,
  config: AuditConfig,
  ctx?: RuleContext,
): boolean {
  return hasEstimateLinkInCard(task, config) || hasScrumEstimateRow(task, ctx);
}

export function describeEstimateLinkContext(task: RawTask): string {
  const linkCount = collectLinkTargets(task).length;
  const descLen = task.descriptionText?.trim().length ?? 0;
  return `ссылок в карточке: ${linkCount}; длина описания: ${descLen} симв.`;
}

export const estimateLinkPresentRule: Rule = {
  id: "estimate_link_present",
  severity: "hard",
  evaluate(task, ctx) {
    if (taskHasEstimateLink(task, ctx.config, ctx)) {
      return pass("estimate_link_present");
    }

    return fail(
      "estimate_link_present",
      `Нет связи со сметой, договором, заявкой или согласованием. ` +
        `Ищем в описании и ссылках карточки (${ESTIMATE_LINK_HINT}) ` +
        `или строку задачи в Google-смете. Ссылка только на ТЗ без сметы не считается. ` +
        describeEstimateLinkContext(task),
    );
  },
};
