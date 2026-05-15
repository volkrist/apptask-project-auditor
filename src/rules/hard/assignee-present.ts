import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";

export const assigneePresentRule: Rule = {
  id: "assignee_present",
  severity: "hard",
  evaluate(task) {
    if (task.assignees.length === 0) {
      return fail("assignee_present", "Не назначен исполнитель");
    }
    return pass("assignee_present");
  },
};
