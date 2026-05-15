import type { Rule } from "../rule-types.js";
import { fail, isBlank, parseRuDate, pass, startOfDay } from "../helpers.js";

/** Проверяет, что дата начала не в прошлом (если указана). */
export const deadlineNotInPastRule: Rule = {
  id: "deadline_not_in_past",
  severity: "hard",
  evaluate(task) {
    if (isBlank(task.startDate)) {
      return pass("deadline_not_in_past", "Дата начала не задана — проверка пропущена");
    }
    const start = parseRuDate(task.startDate);
    if (!start) {
      return fail(
        "deadline_not_in_past",
        `Не удалось разобрать дату начала: «${task.startDate}»`,
      );
    }
    const today = startOfDay(new Date());
    if (start < today) {
      return fail(
        "deadline_not_in_past",
        `Дата начала в прошлом (${task.startDate})`,
      );
    }
    return pass("deadline_not_in_past");
  },
};
