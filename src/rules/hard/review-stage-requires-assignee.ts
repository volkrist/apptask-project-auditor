import type { Rule } from "../rule-types.js";
import {
  canDetermineQaFromUsers,
  fail,
  findQaAssignee,
  hasAnyAssignee,
  isReviewStage,
  pass,
} from "../helpers.js";

export const reviewStageRequiresAssigneeRule: Rule = {
  id: "review_stage_requires_assignee",
  severity: "hard",
  evaluate(task, { config, appTaskUsers }) {
    if (!isReviewStage(task, config.reviewStageKeywords)) {
      return pass("review_stage_requires_assignee");
    }

    if (!hasAnyAssignee(task)) {
      return fail(
        "review_stage_requires_assignee",
        "Карточка находится на проверке, но исполнитель/тестировщик не назначен",
      );
    }

    if (config.qaTesters.length > 0) {
      const qa = findQaAssignee(task, appTaskUsers, config.qaTesters);
      if (!qa.found) {
        return fail(
          "review_stage_requires_assignee",
          "Карточка находится на проверке, но среди исполнителей нет тестировщика",
        );
      }
      return pass("review_stage_requires_assignee");
    }

    if (canDetermineQaFromUsers(appTaskUsers)) {
      const qa = findQaAssignee(task, appTaskUsers, []);
      if (!qa.found) {
        return fail(
          "review_stage_requires_assignee",
          "Карточка находится на проверке, но среди исполнителей нет тестировщика",
        );
      }
      return pass("review_stage_requires_assignee");
    }

    return pass(
      "review_stage_requires_assignee",
      "QA-список не задан, проверено только наличие исполнителя",
    );
  },
};
