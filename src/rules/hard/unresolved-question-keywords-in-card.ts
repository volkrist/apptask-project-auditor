import type { Rule } from "../rule-types.js";
import {
  fail,
  findUnresolvedQuestionInCard,
  notApplicable,
  pass,
  unresolvedQuestionSourceLabel,
} from "../helpers.js";

export const unresolvedQuestionKeywordsInCardRule: Rule = {
  id: "unresolved_question_keywords_in_card",
  severity: "hard",
  evaluate(task, { config }) {
    const hit = findUnresolvedQuestionInCard(
      task,
      config.unresolvedQuestionKeywords,
    );
    if (hit) {
      const where = unresolvedQuestionSourceLabel(hit.source);
      return fail(
        "unresolved_question_keywords_in_card",
        `В ${where} карточки есть признак незакрытого вопроса: ${hit.keyword}`,
      );
    }
    return notApplicable(
      "unresolved_question_keywords_in_card",
      "Маркеры незакрытого вопроса не найдены",
    );
  },
};
