import type { Rule } from "../rule-types.js";
import { isBlank, pass, warn } from "../helpers.js";

export const stageMatchesColumnRule: Rule = {
  id: "stage_matches_column",
  severity: "soft",
  evaluate(task, { config }) {
    if (isBlank(task.status) || isBlank(task.stage)) {
      return warn(
        "stage_matches_column",
        "Статус или этап не заполнены — сопоставление с колонкой невозможно",
      );
    }
    const expected = config.stageByStatus[task.status!];
    if (!expected?.length) {
      return pass(
        "stage_matches_column",
        `Для статуса «${task.status}» нет эталона этапа в конфиге`,
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
