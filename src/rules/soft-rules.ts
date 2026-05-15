import { artifactLinksPresentRule } from "./soft/artifact-links-present.js";
import { descriptionHasGoalRule } from "./soft/description-has-goal.js";
import { estimateLinkPresentRule } from "./soft/estimate-link-present.js";
import { estimatePresentRule } from "./soft/estimate-present.js";
import { notDuplicateRule } from "./soft/not-duplicate.js";
import { stageMatchesColumnRule } from "./soft/stage-matches-column.js";
import { tagsRequiredRule } from "./soft/tags-required.js";
import { titleNotGenericRule } from "./soft/title-not-generic.js";
import type { Rule } from "./rule-types.js";

export const softRules: Rule[] = [
  titleNotGenericRule,
  descriptionHasGoalRule,
  tagsRequiredRule,
  stageMatchesColumnRule,
  estimatePresentRule,
  estimateLinkPresentRule,
  artifactLinksPresentRule,
  notDuplicateRule,
];
