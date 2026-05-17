import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";

export const descriptionPresentRule: Rule = {
  id: "description_present",
  severity: "hard",
  evaluate(task, { config }) {
    const text = task.descriptionText?.trim() ?? "";
    if (!text) {
      return fail("description_present", "Описание задачи отсутствует");
    }
    if (text.length < config.descriptionMinLength) {
      return fail(
        "description_present",
        `Описание слишком короткое (${text.length} символов, минимум ${config.descriptionMinLength})`,
      );
    }
    return pass("description_present");
  },
};
