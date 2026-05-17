import type { Rule } from "../rule-types.js";
import {
  countTitleWords,
  fail,
  isBlank,
  isTitleBlacklisted,
  normalizeTitle,
  pass,
  titleHasOnlyGenericWords,
} from "../helpers.js";

export const titlePresentRule: Rule = {
  id: "title_present",
  severity: "hard",
  evaluate(task, { config }) {
    if (isBlank(task.title)) {
      return fail("title_present", "У задачи нет названия");
    }

    const normalized = normalizeTitle(task.title!);
    if (normalized.length < config.titleMinLength) {
      return fail(
        "title_present",
        `Название слишком короткое (${normalized.length} символов, минимум ${config.titleMinLength})`,
      );
    }

    if (countTitleWords(task.title!) < config.titleMinWords) {
      return fail(
        "title_present",
        `Название должно содержать минимум ${config.titleMinWords} слова`,
      );
    }

    if (titleHasOnlyGenericWords(task.title!, config)) {
      return fail(
        "title_present",
        "Название состоит только из общих слов без конкретики",
      );
    }

    if (isTitleBlacklisted(task.title!, config)) {
      return fail(
        "title_present",
        "Название совпадает с запрещённым общим словом из списка",
      );
    }

    return pass("title_present");
  },
};
