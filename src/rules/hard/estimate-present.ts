import type { Rule } from "../rule-types.js";
import {
  descriptionMatchesPatterns,
  fail,
  isBlank,
  pass,
} from "../helpers.js";

export const estimatePresentRule: Rule = {
  id: "estimate_present",
  severity: "hard",
  evaluate(task, { config }) {
    const planned = task.plannedTime?.trim() ?? "";
    const hasPlanned =
      !isBlank(planned) &&
      !(config.emptyPlannedTimeValues as readonly string[]).includes(planned);
    const hasBudgetInText = descriptionMatchesPatterns(
      task.descriptionText,
      config.estimateTextPatterns,
    );

    if (!hasPlanned && !hasBudgetInText) {
      return fail(
        "estimate_present",
        "Не указано плановое время и нет оценки бюджета/сметы в описании",
      );
    }

    return pass("estimate_present");
  },
};
