import type { Rule } from "../rule-types.js";
import { collectLinkTargets, matchesAnyPattern, pass, warn } from "../helpers.js";

export const estimateLinkPresentRule: Rule = {
  id: "estimate_link_present",
  severity: "soft",
  evaluate(task, { config }) {
    const targets = collectLinkTargets(task);
    if (targets.length === 0) {
      return warn(
        "estimate_link_present",
        "Нет ссылок — не найдена связь со сметой или договором",
      );
    }
    if (!matchesAnyPattern(targets, config.estimateLinkPatterns)) {
      return warn(
        "estimate_link_present",
        "Среди ссылок нет признаков сметы, договора или бюджета",
      );
    }
    return pass("estimate_link_present");
  },
};
