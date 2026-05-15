import type { Rule } from "../rule-types.js";
import { isBlank, normalizeTitle, pass, warn } from "../helpers.js";

export const titleNotGenericRule: Rule = {
  id: "title_not_generic",
  severity: "soft",
  evaluate(task, { config }) {
    if (isBlank(task.title)) {
      return pass("title_not_generic", "Название пустое — проверка пропущена");
    }
    const normalized = normalizeTitle(task.title!);
    const hit = config.genericTitleBlacklist.find((word) =>
      normalized === word || normalized.startsWith(`${word} `) || normalized.endsWith(` ${word}`),
    );
    if (hit) {
      return warn(
        "title_not_generic",
        `Название слишком общее (совпадение с «${hit}»)`,
      );
    }
    if (normalized.length < config.titleMinLength) {
      return warn(
        "title_not_generic",
        `Название слишком короткое (${normalized.length} символов)`,
      );
    }
    return pass("title_not_generic");
  },
};
