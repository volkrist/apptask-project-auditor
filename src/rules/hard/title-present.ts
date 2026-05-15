import type { Rule } from "../rule-types.js";
import { fail, isBlank, pass } from "../helpers.js";

export const titlePresentRule: Rule = {
  id: "title_present",
  severity: "hard",
  evaluate(task) {
    if (isBlank(task.title)) {
      return fail("title_present", "У задачи нет названия");
    }
    return pass("title_present");
  },
};
