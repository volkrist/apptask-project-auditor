import type { Rule } from "../rule-types.js";
import {
  describeTaskTypeContext,
  extractTaskType,
  fail,
  formatAllowedTaskTypes,
  pass,
} from "../helpers.js";

export const taskTypeValidRule: Rule = {
  id: "task_type_valid",
  severity: "hard",
  evaluate(task, { config }) {
    const extracted = extractTaskType(task, config);
    const allowedLabel = formatAllowedTaskTypes(config);
    const context = describeTaskTypeContext(task);

    if (!extracted) {
      return fail(
        "task_type_valid",
        `Тип задачи не указан. Нужен тег из списка: ${allowedLabel}. ` +
          `Колонка доски (Frontend, UI/UX и т.п.) не считается типом. ${context}`,
      );
    }

    const allowed = config.requiredTaskTypes.map((t) => t.toLowerCase());
    if (!allowed.includes(extracted)) {
      return fail(
        "task_type_valid",
        `Тип «${extracted}» не входит в допустимый список: ${allowedLabel}. ${context}`,
      );
    }
    return pass("task_type_valid");
  },
};
