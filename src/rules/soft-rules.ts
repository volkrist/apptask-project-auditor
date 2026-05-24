import { assigneeNotInUsersListRule } from "./soft/assignee-not-in-users-list.js";
import { deadlineRealisticRule } from "./soft/deadline-realistic.js";
import { notDuplicateRule } from "./soft/not-duplicate.js";
import { stageMatchesColumnRule } from "./soft/stage-matches-column.js";
import { tagsRequiredRule } from "./soft/tags-required.js";
import type { Rule } from "./rule-types.js";

export const softRules: Rule[] = [
  assigneeNotInUsersListRule,
  tagsRequiredRule,
  stageMatchesColumnRule,
  deadlineRealisticRule,
  notDuplicateRule,
];
