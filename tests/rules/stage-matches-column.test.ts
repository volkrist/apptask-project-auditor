import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { stageMatchesColumnRule } from "../../src/rules/soft/stage-matches-column.js";
import {
  isStageSameAsStatus,
  stageMatchesStatus,
} from "../../src/rules/soft/stage-match-helpers.js";

const config = loadAuditConfig();

function evaluate(status: string | null, stage: string | null) {
  const task = { ...emptyRawTask(), status, stage };
  return stageMatchesColumnRule.evaluate(task, { config, allTasks: [task] });
}

test("isStageSameAsStatus: дубликат статуса", () => {
  const task = { ...emptyRawTask(), status: "В процессе", stage: "В процессе" };
  assert.equal(isStageSameAsStatus(task), true);
});

test("stageMatchesStatus: «1 этап» при «В процессе»", () => {
  assert.equal(stageMatchesStatus("1 этап", "В процессе", config), true);
});

test("stageMatchesStatus: «1 этап» при «На проверке» → false", () => {
  assert.equal(stageMatchesStatus("1 этап", "На проверке", config), false);
});

test("stage_matches_column: DB — stage null → FAIL", () => {
  const r = evaluate("В процессе", null);
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /Этап.*не заполнен/i);
});

test("stage_matches_column: stage = status → FAIL", () => {
  const r = evaluate("В процессе", "В процессе");
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /совпадает со статусом/i);
});

test("stage_matches_column: «1 этап» + «В процессе» → PASS", () => {
  assert.equal(evaluate("В процессе", "1 этап").status, "PASS");
});

test("stage_matches_column: «этап QA» + «На проверке» → PASS", () => {
  assert.equal(evaluate("На проверке", "этап QA").status, "PASS");
});

test("stage_matches_column: «1 этап» + «На проверке» → FAIL", () => {
  const r = evaluate("На проверке", "1 этап");
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /не соответствует/i);
});
