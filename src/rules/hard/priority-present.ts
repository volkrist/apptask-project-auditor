import type { Rule } from "../rule-types.js";
import { fail, isBlank, pass } from "../helpers.js";

export const priorityPresentRule: Rule = {
  id: "priority_present",
  severity: "hard",
  evaluate(task) {
    if (isBlank(task.priority)) {
      return fail("priority_present", "Не указан приоритет");
    }
    return pass("priority_present");
  },
};
