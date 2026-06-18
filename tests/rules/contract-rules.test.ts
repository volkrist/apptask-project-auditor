import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { blockedTagPresentRule } from "../../src/rules/contract/contract-rules.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("blocked_tag_present fails when blocked without tag", async () => {
  const task = {
    ...emptyRawTask(),
    status: "Заблокировано",
    tags: [],
  };
  const r = await blockedTagPresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
});

test("blocked_tag_present passes with blocked tag", async () => {
  const task = {
    ...emptyRawTask(),
    status: "Заблокировано",
    tags: ["blocked"],
  };
  const r = await blockedTagPresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});
