import assert from "node:assert/strict";
import { test } from "node:test";
import { registryHasZeroCandidates } from "../../src/reports/check-registry-stats.js";
import type { RegistryTableRow } from "../../src/reports/check-registry-stats.js";
import type { ContractCheckRegistryEntry } from "../../src/config/contract-check-registry.js";

function row(candidates: string): RegistryTableRow {
  return {
    entry: { num: 1, title: "t", scope: "s", ruleIds: ["deadline_less_than_one_day"] } as ContractCheckRegistryEntry,
    checked: "64 задачи",
    candidates,
    unavailable: "—",
    violations: "0",
    outcome: "OK",
  };
}

test("registryHasZeroCandidates detects zero candidate strings", () => {
  assert.equal(registryHasZeroCandidates(row("0 задач с дедлайном < 1 дня")), true);
  assert.equal(registryHasZeroCandidates(row("0 заблокированных задач")), true);
  assert.equal(registryHasZeroCandidates(row("0 в области правила")), true);
  assert.equal(registryHasZeroCandidates(row("3 задач с дедлайном < 1 дня")), false);
});
