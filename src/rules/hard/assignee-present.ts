import type { Rule } from "../rule-types.js";
import { fail, notApplicable, pass } from "../helpers.js";
import { assigneeRequiredForStatus } from "../status/status-helpers.js";

export const assigneePresentRule: Rule = {
  id: "assignee_present",
  severity: "hard",
  evaluate(task) {
    if (!assigneeRequiredForStatus(task.status)) {
      return notApplicable(
        "assignee_present",
        "Задача не в работе и не на проверке — исполнитель не обязателен",
      );
    }
    if (task.assignees.length === 0) {
      return fail("assignee_present", "Не назначен исполнитель");
    }
    return pass("assignee_present");
  },
};
