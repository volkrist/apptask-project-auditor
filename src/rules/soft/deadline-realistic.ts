import type { Rule } from "../rule-types.js";
import { isBlank, parseRuDate, pass, warn } from "../helpers.js";

/** Эвристика: срок не совпадает с датой создания при слишком коротком интервале. */
export const deadlineRealisticRule: Rule = {
  id: "deadline_realistic",
  severity: "soft",
  evaluate(task, { config }) {
    if (isBlank(task.dueDate) || isBlank(task.createdAt)) {
      return pass(
        "deadline_realistic",
        "Дата создания или дедлайн не заданы — эвристика пропущена",
      );
    }

    const created = parseRuDate(task.createdAt);
    const due = parseRuDate(task.dueDate);
    if (!created || !due) {
      return warn(
        "deadline_realistic",
        "Не удалось оценить реалистичность срока — даты не разобраны",
      );
    }

    const spanDays = Math.round(
      (due.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (task.dueDate === task.createdAt) {
      return warn(
        "deadline_realistic",
        "Срок окончания совпадает с датой создания — возможно нереалистичный дедлайн",
      );
    }

    if (spanDays < config.minRealisticDueSpanDays) {
      return warn(
        "deadline_realistic",
        `Срок до дедлайна ${spanDays} дн. (меньше ${config.minRealisticDueSpanDays}) — проверьте реалистичность`,
      );
    }

    return pass("deadline_realistic");
  },
};
