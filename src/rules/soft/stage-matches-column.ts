import type { Rule } from "../rule-types.js";
import { fail, isBlank, pass } from "../helpers.js";
import {
  isBoardStageAllowed,
  isStageSameAsStatus,
  stageColumnCheckPasses,
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
        "Поле «Этап» не заполнено — укажите воронку/спринт в карточке AppTask",
      );
    }

    if (isStageSameAsStatus(task)) {
      return fail(
        "stage_matches_column",
        `Этап совпадает со статусом колонки («${task.stage}») — укажите отдельный этап/воронку в карточке`,
      );
    }

    if (!stageColumnCheckPasses(task)) {
      return fail(
        "stage_matches_column",
        `Этап «${task.stage}» не соответствует статусу «${task.status}»`,
      );
    }

    if (
      isBoardStageAllowed(task.boardId, task.stage!, task.status!, config)
    ) {
      return pass(
        "stage_matches_column",
        `Этап «${task.stage}» соответствует статусу «${task.status}» (маппинг доски ${task.boardId})`,
      );
    }

    return pass(
      "stage_matches_column",
      "Этап заполнен и отличается от статуса колонки",
    );
  },
};
