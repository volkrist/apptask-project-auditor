import type { Rule } from "../rule-types.js";
import { fail, isBlank, isTitleBlacklisted, pass } from "../helpers.js";

export const titleNotGenericRule: Rule = {
  id: "title_not_generic",
  severity: "hard",
  evaluate(task, { config }) {
    if (isBlank(task.title)) {
      return pass("title_not_generic", "Название пустое — проверка пропущена");
    }

    if (isTitleBlacklisted(task.title!, config)) {
      return fail(
        "title_not_generic",
        "Название слишком общее (совпадение с запрещённым словом из blacklist)",
      );
    }

    return pass("title_not_generic");
  },
};
