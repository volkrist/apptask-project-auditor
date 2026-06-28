import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";
import { descriptionIndicatesGoal } from "./description-goal-text.js";

export const descriptionHasGoalRule: Rule = {
  id: "description_has_goal",
  severity: "hard",
  evaluate(task, { config }) {
    const text = task.descriptionText?.trim() ?? "";
    if (!text) {
      return fail(
        "description_has_goal",
        "Описание пустое — нельзя проверить цель или ожидаемый результат",
      );
    }

    if (!descriptionIndicatesGoal(text, config.goalKeywords)) {
      return fail(
        "description_has_goal",
        "В описании нет явной формулировки цели или результата (секция «Цель:/Результат:» или маркеры вроде «необходимо», «ожидаемый результат», «должен включать»)",
      );
    }
    return pass("description_has_goal");
  },
};
