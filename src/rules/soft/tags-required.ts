import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";

export const tagsRequiredRule: Rule = {
  id: "tags_required",
  severity: "soft",
  evaluate(task, { config }) {
    if (config.requiredTags.length === 0) {
      return pass("tags_required", "Обязательные теги не настроены — проверка пропущена");
    }

    const taskTags = task.tags.map((t) => t.toLowerCase());
    const missing = config.requiredTags.filter(
      (required) =>
        !taskTags.some((tag) => tag.includes(required.toLowerCase())),
    );
    if (missing.length > 0) {
      return fail(
        "tags_required",
        `Отсутствуют обязательные теги: ${missing.join(", ")}`,
      );
    }
    return pass("tags_required");
  },
};
