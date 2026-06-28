import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { assigneePresentRule } from "../../src/rules/hard/assignee-present.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";

const config = loadAuditConfig();

function evaluate(status: string | null, assignees: string[] = []) {
  const task = {
    ...emptyRawTask(),
    status,
    assignees,
  };
  return assigneePresentRule.evaluate(task, { config, allTasks: [task] });
}

test("assignee_present: в процессе без исполнителя → FAIL", () => {
  assert.equal(evaluate("В процессе").status, "FAIL");
});

test("assignee_present: на проверке без исполнителя → FAIL", () => {
  assert.equal(evaluate("На проверке").status, "FAIL");
});

test("assignee_present: в процессе с исполнителем → PASS", () => {
  assert.equal(evaluate("В процессе", ["Иван"]).status, "PASS");
});

test("assignee_present: завершено без исполнителя → NOT_APPLICABLE", () => {
  const r = evaluate("Завершено");
  assert.equal(r.status, "NOT_APPLICABLE");
  assert.match(r.reason, /не в работе/i);
});

test("assignee_present: новая задача без исполнителя → NOT_APPLICABLE", () => {
  assert.equal(evaluate("Новая задача").status, "NOT_APPLICABLE");
});
