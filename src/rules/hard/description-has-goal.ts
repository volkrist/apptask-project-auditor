import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";

export const descriptionHasGoalRule: Rule = {
  id: "description_has_goal",
  severity: "hard",
  evaluate(task, { config }) {
    const text = task.descriptionText?.toLowerCase() ?? "";
    if (!text) {
      return fail(
        "description_has_goal",
        "Описание пустое — нельзя проверить цель или ожидаемый результат",
      );
    }

    const hasGoal = config.goalKeywords.some((keyword) =>
      text.includes(keyword.toLowerCase()),
    );
    if (!hasGoal) {
      return fail(
        "description_has_goal",
        "В описании не указаны цель, ожидаемый результат или критерии готовности",
      );
    }
    return pass("description_has_goal");
  },
};
