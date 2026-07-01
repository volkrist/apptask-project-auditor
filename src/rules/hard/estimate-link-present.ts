import type { AuditConfig } from "../../config/audit-config.js";
import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule } from "../rule-types.js";
import { collectLinkTargets, fail, isBlank, matchesAnyPattern, pass } from "../helpers.js";

const ESTIMATE_LINK_HINT =
  "смета, договор, заявка, согласование, Google Sheets (spreadsheets)";

/** Ссылка или явное упоминание сметы/договора только в тексте и ссылках карточки. */
export function taskHasEstimateLinkInCard(
  task: RawTask,
  config: AuditConfig,
): boolean {
  const targets = collectLinkTargets(task);
  const textBlob = [task.descriptionText ?? "", ...targets].join("\n");
  return matchesAnyPattern([textBlob], config.estimateLinkPatterns);
}

/** Связь со сметой только по описанию и ссылкам карточки (не по Google-смете и не по ПВ). */
export function taskHasEstimateLink(
  task: RawTask,
  config: AuditConfig,
): boolean {
  return taskHasEstimateLinkInCard(task, config);
}

export function describeEstimateLinkContext(task: RawTask): string {
  const linkCount = collectLinkTargets(task).length;
  const descLen = task.descriptionText?.trim().length ?? 0;
  const pv = task.plannedTime?.trim();
  const pvNote =
    pv && !isBlank(pv) ? `; ПВ в карточке: ${pv} (не заменяет ссылку на смету)` : "";
  return `ссылок в карточке: ${linkCount}; длина описания: ${descLen} симв.${pvNote}`;
}

export const estimateLinkPresentRule: Rule = {
  id: "estimate_link_present",
  severity: "hard",
  evaluate(task, ctx) {
    if (taskHasEstimateLinkInCard(task, ctx.config)) {
      return pass("estimate_link_present");
    }

    return fail(
      "estimate_link_present",
      `Нет ссылки на смету, договор, заявку или согласование в описании/ссылках карточки. ` +
        `Ищем в карточке AppTask (${ESTIMATE_LINK_HINT}). ` +
        `Заполненное поле «Примерное время» (ПВ) не заменяет ссылку на смету. ` +
        `Строка в Google-смете без ссылки в карточке тоже не засчитывается. ` +
        `Ссылка только на ТЗ без сметы не считается. ` +
        describeEstimateLinkContext(task),
    );
  },
};
