import { assigneePresentRule } from "./hard/assignee-present.js";
import { blockedAssigneeNotAllowedRule } from "./hard/blocked-assignee-not-allowed.js";
import { artifactLinksPresentRule } from "./hard/artifact-links-present.js";
import { deadlineNotOverdueRule } from "./hard/deadline-not-overdue.js";
import { deadlinePresentRule } from "./hard/deadline-present.js";
import { deadlineStartNotAfterDueRule } from "./hard/deadline-start-not-after-due.js";
import { descriptionHasGoalRule } from "./hard/description-has-goal.js";
import { descriptionPresentRule } from "./hard/description-present.js";
import { estimateLinkPresentRule } from "./hard/estimate-link-present.js";
import { estimatePresentRule } from "./hard/estimate-present.js";
import { linksReachableRule } from "./hard/links-reachable.js";
import { priorityPresentRule } from "./hard/priority-present.js";
import { reviewStageRequiresAssigneeRule } from "./hard/review-stage-requires-assignee.js";
import { taskTypeValidRule } from "./hard/task-type-valid.js";
import { unresolvedQuestionKeywordsInCardRule } from "./hard/unresolved-question-keywords-in-card.js";
import { titleNotGenericRule } from "./hard/title-not-generic.js";
import { titlePresentRule } from "./hard/title-present.js";
import type { Rule } from "./rule-types.js";

export const hardRules: Rule[] = [
  titlePresentRule,
  titleNotGenericRule,
  descriptionPresentRule,
  descriptionHasGoalRule,
  assigneePresentRule,
  blockedAssigneeNotAllowedRule,
  deadlinePresentRule,
  deadlineNotOverdueRule,
  deadlineStartNotAfterDueRule,
  priorityPresentRule,
  taskTypeValidRule,
  estimatePresentRule,
  estimateLinkPresentRule,
  artifactLinksPresentRule,
  linksReachableRule,
  unresolvedQuestionKeywordsInCardRule,
  reviewStageRequiresAssigneeRule,
];
