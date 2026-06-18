import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTRACT_TURBOWEAVE_V1,
  getAuditProfile,
  isRuleInProfile,
  resolveAuditProfileId,
} from "../../src/config/audit-profiles.js";

test("contract profile excludes generic deadline_present", () => {
  const profile = getAuditProfile("contract_turboweave_v1");
  assert.equal(isRuleInProfile("deadline_present", profile), false);
  assert.equal(isRuleInProfile("artifact_links_present", profile), false);
  assert.equal(isRuleInProfile("in_progress_stale", profile), true);
  assert.equal(isRuleInProfile("scrum_task_in_estimate", profile), true);
});

test("legacy profile includes all rules", () => {
  const profile = getAuditProfile("legacy_generic");
  assert.equal(isRuleInProfile("deadline_present", profile), true);
});

test("resolveAuditProfileId defaults to contract", () => {
  const prev = process.env.AUDIT_PROFILE;
  delete process.env.AUDIT_PROFILE;
  assert.equal(resolveAuditProfileId(), "contract_turboweave_v1");
  if (prev) process.env.AUDIT_PROFILE = prev;
});

test("contract profile has flow patterns", () => {
  assert.ok(CONTRACT_TURBOWEAVE_V1.flowTaskPatterns.length > 0);
});
