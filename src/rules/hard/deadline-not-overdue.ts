import type { Rule } from "../rule-types.js";
import { fail, isBlank, parseRuDate, pass, startOfDay } from "../helpers.js";

export const deadlineNotOverdueRule: Rule = {
  id: "deadline_not_overdue",
  severity: "hard",
  evaluate(task) {
    if (isBlank(task.dueDate)) {
      return pass("deadline_not_overdue", "Дедлайн не задан — проверка пропущена");
    }
    const due = parseRuDate(task.dueDate);
    if (!due) {
      return fail(
        "deadline_not_overdue",
        `Не удалось разобрать дату окончания: «${task.dueDate}»`,
      );
    }
    const today = startOfDay(new Date());
    if (due < today) {
      return fail(
        "deadline_not_overdue",
        `Срок окончания просрочен (${task.dueDate})`,
      );
    }
    return pass("deadline_not_overdue");
  },
};
