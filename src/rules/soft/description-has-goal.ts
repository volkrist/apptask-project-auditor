import type { Rule } from "../rule-types.js";
import { isBlank, pass, warn } from "../helpers.js";

export const descriptionHasGoalRule: Rule = {
  id: "description_has_goal",
  severity: "soft",
  evaluate(task, { config }) {
    const text = task.descriptionText?.toLowerCase() ?? "";
    if (!text) {
      return pass("description_has_goal", "Описание пустое — проверка пропущена");
    }
    const hasGoal = config.goalKeywords.some((keyword) =>
      text.includes(keyword.toLowerCase()),
    );
    if (!hasGoal) {
      return warn(
        "description_has_goal",
        "В описании не найдены формулировки цели или ожидаемого результата",
      );
    }
    return pass("description_has_goal");
  },
};
