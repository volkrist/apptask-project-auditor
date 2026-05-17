import type { Rule } from "../rule-types.js";
import { fail, isBlank, pass, warn } from "../helpers.js";

export const stageMatchesColumnRule: Rule = {
  id: "stage_matches_column",
  severity: "soft",
  evaluate(task, { config }) {
    if (isBlank(task.status) || isBlank(task.stage)) {
      return fail(
        "stage_matches_column",
        "Не заполнены статус или этап — невозможно сопоставить с колонкой",
      );
    }

    const expected = config.stageByStatus[task.status!];
    if (!expected?.length) {
      return warn(
        "stage_matches_column",
        `Для статуса «${task.status}» нет эталона этапа в конфиге — проверка эвристическая`,
      );
    }

    const stageLower = task.stage!.toLowerCase();
    const matches = expected.some((fragment) =>
      stageLower.includes(fragment.toLowerCase()),
    );
    if (!matches) {
      return warn(
        "stage_matches_column",
        `Этап «${task.stage}» не соответствует статусу «${task.status}»`,
      );
    }
    return pass("stage_matches_column");
  },
};
