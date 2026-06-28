import type { Rule } from "../rule-types.js";
import { fail, pass } from "../helpers.js";

function normalizedTags(tags: string[]): string[] {
  return tags.map((t) => t.trim()).filter(Boolean);
}

export const tagsRequiredRule: Rule = {
  id: "tags_required",
  severity: "soft",
  evaluate(task, { config }) {
    const taskTags = normalizedTags(task.tags);
    if (taskTags.length === 0) {
      return fail("tags_required", "Теги не указаны");
    }

    if (config.requiredTags.length === 0) {
      return pass("tags_required");
    }

    const taskTagsLower = taskTags.map((t) => t.toLowerCase());
    const missing = config.requiredTags.filter(
      (required) =>
        !taskTagsLower.some((tag) => tag.includes(required.toLowerCase())),
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
