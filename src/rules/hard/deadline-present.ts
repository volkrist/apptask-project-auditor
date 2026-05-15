import type { Rule } from "../rule-types.js";
import { fail, isBlank, pass } from "../helpers.js";

export const deadlinePresentRule: Rule = {
  id: "deadline_present",
  severity: "hard",
  evaluate(task) {
    if (isBlank(task.dueDate)) {
      return fail("deadline_present", "Не указан срок окончания (дедлайн)");
    }
    return pass("deadline_present");
  },
};
