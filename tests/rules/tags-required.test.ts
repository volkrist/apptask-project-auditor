import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { tagsRequiredRule } from "../../src/rules/soft/tags-required.js";

const baseConfig = loadAuditConfig({ linkCheckEnabled: false });

function evaluate(tags: string[], requiredTags: string[] = []) {
  const task = { ...emptyRawTask(), tags };
  const config = { ...baseConfig, requiredTags };
  return tagsRequiredRule.evaluate(task, { config, allTasks: [task] });
}

test("tags_required: без тегов → FAIL", () => {
  const r = evaluate([]);
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /не указаны/i);
});

test("tags_required: есть тег, REQUIRED_TAGS не задан → PASS", () => {
  assert.equal(evaluate(["баг"]).status, "PASS");
});

test("tags_required: REQUIRED_TAGS задан, тег есть → PASS", () => {
  assert.equal(evaluate(["срочно", "баг"], ["срочно"]).status, "PASS");
});

test("tags_required: REQUIRED_TAGS задан, тег отсутствует → FAIL", () => {
  const r = evaluate(["баг"], ["срочно", "клиент"]);
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /срочно/);
  assert.match(r.reason, /клиент/);
});

test("tags_required: только пробелы в тегах → FAIL", () => {
  assert.equal(evaluate(["", "   "]).status, "FAIL");
});
