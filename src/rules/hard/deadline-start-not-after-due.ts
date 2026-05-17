import type { Rule } from "../rule-types.js";
import { fail, isBlank, parseRuDate, pass } from "../helpers.js";

/** Дата начала не позже срока окончания. */
export const deadlineStartNotAfterDueRule: Rule = {
  id: "deadline_start_not_after_due",
  severity: "hard",
  evaluate(task) {
    if (isBlank(task.startDate) || isBlank(task.dueDate)) {
      return pass(
        "deadline_start_not_after_due",
        "Дата начала или дедлайн не заданы — проверка пропущена",
      );
    }

    const start = parseRuDate(task.startDate);
    const due = parseRuDate(task.dueDate);
    if (!start || !due) {
      return fail(
        "deadline_start_not_after_due",
        `Не удалось разобрать даты начала (${task.startDate}) или окончания (${task.dueDate})`,
      );
    }

    if (start > due) {
      return fail(
        "deadline_start_not_after_due",
        `Дата начала (${task.startDate}) позже срока окончания (${task.dueDate})`,
      );
    }

    return pass("deadline_start_not_after_due");
  },
};
