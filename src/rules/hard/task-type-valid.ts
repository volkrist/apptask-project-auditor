import type { Rule } from "../rule-types.js";
import { extractTaskType, fail, pass } from "../helpers.js";

export const taskTypeValidRule: Rule = {
  id: "task_type_valid",
  severity: "hard",
  evaluate(task, { config }) {
    const extracted = extractTaskType(task, config);
    if (!extracted) {
      return fail(
        "task_type_valid",
        "Не удалось определить тип задачи по тегам или категории",
      );
    }

    const allowed = config.requiredTaskTypes.map((t) => t.toLowerCase());
    if (!allowed.includes(extracted)) {
      return fail(
        "task_type_valid",
        `Тип задачи «${extracted}» не входит в допустимый список`,
      );
    }
    return pass("task_type_valid");
  },
};
