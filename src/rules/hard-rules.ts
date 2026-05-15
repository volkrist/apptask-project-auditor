import { assigneePresentRule } from "./hard/assignee-present.js";
import { deadlineNotInPastRule } from "./hard/deadline-not-in-past.js";
import { deadlineNotOverdueRule } from "./hard/deadline-not-overdue.js";
import { deadlinePresentRule } from "./hard/deadline-present.js";
import { descriptionPresentRule } from "./hard/description-present.js";
import { linksReachableRule } from "./hard/links-reachable.js";
import { priorityPresentRule } from "./hard/priority-present.js";
import { taskTypeValidRule } from "./hard/task-type-valid.js";
import { titlePresentRule } from "./hard/title-present.js";
import type { Rule } from "./rule-types.js";

export const hardRules: Rule[] = [
  titlePresentRule,
  descriptionPresentRule,
  assigneePresentRule,
  deadlinePresentRule,
  deadlineNotOverdueRule,
  deadlineNotInPastRule,
  priorityPresentRule,
  taskTypeValidRule,
  linksReachableRule,
];
