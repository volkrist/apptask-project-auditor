import type { Rule } from "../rule-types.js";
import { collectLinkTargets, matchesAnyPattern, pass, warn } from "../helpers.js";

export const artifactLinksPresentRule: Rule = {
  id: "artifact_links_present",
  severity: "soft",
  evaluate(task, { config }) {
    const targets = collectLinkTargets(task);
    if (targets.length === 0) {
      return warn(
        "artifact_links_present",
        "Нет ссылок на артефакты (макет, репозиторий, ТЗ)",
      );
    }
    if (!matchesAnyPattern(targets, config.artifactLinkPatterns)) {
      return warn(
        "artifact_links_present",
        "Среди ссылок нет типичных артефактов (Figma, GitHub, макет, ТЗ)",
      );
    }
    return pass("artifact_links_present");
  },
};
