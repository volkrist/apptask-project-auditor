import type { Rule } from "../rule-types.js";
import { collectLinkTargets, fail, matchesAnyPattern, pass } from "../helpers.js";

export const artifactLinksPresentRule: Rule = {
  id: "artifact_links_present",
  severity: "hard",
  evaluate(task, { config }) {
    const targets = collectLinkTargets(task);
    if (targets.length === 0) {
      return fail(
        "artifact_links_present",
        "Нет ссылок на артефакты (макет, ТЗ, репозиторий, документация)",
      );
    }

    if (!matchesAnyPattern(targets, config.artifactLinkPatterns)) {
      return fail(
        "artifact_links_present",
        "Среди ссылок нет макета, ТЗ, репозитория или документации",
      );
    }
    return pass("artifact_links_present");
  },
};
