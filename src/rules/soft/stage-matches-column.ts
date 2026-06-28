import type { Rule } from "../rule-types.js";
import { fail, isBlank, pass, warn } from "../helpers.js";
import {
  configuredStatusLabels,
  expectedStageMarkers,
  isStageSameAsStatus,
  stageMatchesStatus,
} from "./stage-match-helpers.js";

export const stageMatchesColumnRule: Rule = {
  id: "stage_matches_column",
  severity: "soft",
  evaluate(task, { config }) {
    if (isBlank(task.status)) {
      return fail(
        "stage_matches_column",
        "Статус задачи не указан — невозможно проверить этап/воронку",
      );
    }

    if (isBlank(task.stage)) {
      return fail(
        "stage_matches_column",
        `Поле «Этап» не заполнено. Для статуса «${task.status}» ожидается этап с маркерами: ${expectedStageMarkers(task.status!, config)}`,
      );
    }

    if (isStageSameAsStatus(task)) {
      return fail(
        "stage_matches_column",
        `Этап совпадает со статусом колонки («${task.stage}») — укажите отдельный этап/воронку в карточке`,
      );
    }

    const expected = config.stageByStatus[task.status!];
    if (!expected?.length) {
      return warn(
        "stage_matches_column",
        `Для статуса «${task.status}» нет эталона в конфиге (настроены: ${configuredStatusLabels(config)})`,
      );
    }

    if (!stageMatchesStatus(task.stage!, task.status!, config)) {
      return fail(
        "stage_matches_column",
        `Этап «${task.stage}» не соответствует статусу «${task.status}» (ожидаются маркеры: ${expected.join(", ")})`,
      );
    }
    return pass("stage_matches_column");
  },
};
