import type { Rule } from "../rule-types.js";
import { isBlank, pass, warn } from "../helpers.js";

export const estimatePresentRule: Rule = {
  id: "estimate_present",
  severity: "soft",
  evaluate(task, { config }) {
    if (isBlank(task.plannedTime)) {
      return warn("estimate_present", "Не указано примерное (плановое) время");
    }
    const planned = task.plannedTime!.trim();
    if ((config.emptyPlannedTimeValues as readonly string[]).includes(planned)) {
      return warn("estimate_present", "Плановое время указано как нулевое");
    }
    return pass("estimate_present");
  },
};
