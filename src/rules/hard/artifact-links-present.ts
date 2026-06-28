import type { AuditConfig } from "../../config/audit-config.js";
import type { RawTask } from "../../adapters/apptask/types.js";
import type { Rule } from "../rule-types.js";
import type { RuleContext } from "../rule-types.js";
import { matchTaskToEstimate } from "../../scrum/estimate-matcher.js";
import { collectLinkTargets, fail, matchesAnyPattern, pass } from "../helpers.js";

const ARTIFACT_HINT =
  "макет (Figma и др.), ТЗ, документация, репозиторий, заявка или строка в Google-смете";

function hasArtifactInCard(task: RawTask, config: AuditConfig): boolean {
  const targets = collectLinkTargets(task);
  const textBlob = [task.descriptionText ?? "", ...targets].join("\n");
  return matchesAnyPattern([textBlob], config.artifactLinkPatterns);
}

function hasScrumEstimateRow(task: RawTask, ctx?: RuleContext): boolean {
  if (!ctx?.scrum?.loaded || !ctx.scrum.rows?.length) return false;
  return matchTaskToEstimate(task, ctx.scrum.rows).kind !== "not_found";
}

/** Хотя бы один артефакт: макет, ТЗ, документация, репозиторий, заявка или строка в смете. */
export function taskHasArtifactLinks(
  task: RawTask,
  config: AuditConfig,
  ctx?: RuleContext,
): boolean {
  return hasArtifactInCard(task, config) || hasScrumEstimateRow(task, ctx);
}

export const artifactLinksPresentRule: Rule = {
  id: "artifact_links_present",
  severity: "hard",
  evaluate(task, ctx) {
    if (taskHasArtifactLinks(task, ctx.config, ctx)) {
      return pass(
        "artifact_links_present",
        "Найден артефакт: макет, ТЗ, документация, репозиторий, заявка или задача в смете",
      );
    }

    const targets = collectLinkTargets(task);
    if (targets.length === 0 && !task.descriptionText?.trim()) {
      return fail(
        "artifact_links_present",
        `Нет ссылок на артефакты (${ARTIFACT_HINT})`,
      );
    }

    return fail(
      "artifact_links_present",
      `Среди описания и ссылок нет артефактов (${ARTIFACT_HINT}). ` +
        `Ссылка только на смету/договор без ТЗ или макета — не засчитывается`,
    );
  },
};
