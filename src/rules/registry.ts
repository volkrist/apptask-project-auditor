import { hardRules } from "./hard-rules.js";
import { softRules } from "./soft-rules.js";
import { contractRules } from "./contract/contract-rules.js";
import type { Rule } from "./rule-types.js";

export const allRules: Rule[] = [...hardRules, ...softRules, ...contractRules];
