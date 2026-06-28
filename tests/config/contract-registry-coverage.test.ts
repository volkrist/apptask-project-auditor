import assert from "node:assert/strict";
import { test } from "node:test";
import { getAuditProfile } from "../../src/config/audit-profiles.js";
import { getFullCheckRegistry } from "../../src/config/contract-check-registry.js";
import { allRules } from "../../src/rules/registry.js";
import { isEntityRule } from "../../src/rules/rule-scopes.js";
import { ruleLabel } from "../../src/reports/rule-labels.js";

test("every registry check maps to a registered rule with label", () => {
  const knownRuleIds = new Set(allRules.map((r) => r.id));
  const profile = getAuditProfile("contract_turboweave_v1");

  for (const entry of getFullCheckRegistry()) {
    for (const ruleId of entry.ruleIds) {
      assert.ok(knownRuleIds.has(ruleId), `missing rule implementation: ${ruleId}`);
      assert.ok(ruleLabel(ruleId).length > 0, `missing label: ${ruleId}`);
      if (!isEntityRule(ruleId)) {
        assert.equal(
          profile.ruleIds.has(ruleId),
          true,
          `rule ${ruleId} not in contract profile`,
        );
      }
    }
  }
});
