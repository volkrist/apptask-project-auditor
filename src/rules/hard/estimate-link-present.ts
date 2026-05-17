import type { Rule } from "../rule-types.js";
import { collectLinkTargets, fail, matchesAnyPattern, pass } from "../helpers.js";

export const estimateLinkPresentRule: Rule = {
  id: "estimate_link_present",
  severity: "hard",
  evaluate(task, { config }) {
    const targets = collectLinkTargets(task);
    const textBlob = [task.descriptionText ?? "", ...targets].join("\n");

    if (!matchesAnyPattern([textBlob], config.estimateLinkPatterns)) {
      return fail(
        "estimate_link_present",
        "Нет ссылки или упоминания сметы, договора, заявки или согласования",
      );
    }
    return pass("estimate_link_present");
  },
};
