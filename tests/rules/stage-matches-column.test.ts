import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { stageMatchesColumnRule } from "../../src/rules/soft/stage-matches-column.js";
import {
  isBoardStageAllowed,
  isStageSameAsStatus,
  stageColumnCheckPasses,
  stageMatchesStatus,
} from "../../src/rules/soft/stage-match-helpers.js";

const config = loadAuditConfig();

function evaluate(
  status: string | null,
  stage: string | null,
  boardId = "783",
) {
  const task = { ...emptyRawTask(), boardId, status, stage };
  return stageMatchesColumnRule.evaluate(task, { config, allTasks: [task] });
}

test("isStageSameAsStatus: дубликат статуса", () => {
  const task = { ...emptyRawTask(), status: "В процессе", stage: "В процессе" };
  assert.equal(isStageSameAsStatus(task), true);
});

test("stageMatchesStatus: legacy маркеры (не используются правилом)", () => {
  assert.equal(stageMatchesStatus("1 этап", "В процессе", config), true);
  assert.equal(stageMatchesStatus("1 этап", "На проверке", config), false);
});

test("isBoardStageAllowed: TurboWeave ТЕСТ + В процессе", () => {
  assert.equal(
    isBoardStageAllowed("783", "ТЕСТ", "В процессе", config),
    true,
  );
});

test("isBoardStageAllowed: Написание ТЗ + Новая задача", () => {
  assert.equal(
    isBoardStageAllowed("783", "Написание ТЗ", "Новая задача", config),
    true,
  );
});

test("stage_matches_column: stage null → FAIL", () => {
  const r = evaluate("В процессе", null);
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /Этап.*не заполнен/i);
});

test("stage_matches_column: stage = status → FAIL", () => {
  const r = evaluate("В процессе", "В процессе");
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /совпадает со статусом/i);
});

test("stage_matches_column: ТЕСТ + В процессе (board 783) → PASS", () => {
  const r = evaluate("В процессе", "ТЕСТ");
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /маппинг доски 783/i);
});

test("stage_matches_column: Написание ТЗ + Новая задача → PASS", () => {
  assert.equal(evaluate("Новая задача", "Написание ТЗ").status, "PASS");
});

test("stage_matches_column: произвольный этап ≠ статус → PASS (смягчённое правило)", () => {
  const r = evaluate("На проверке", "1 этап");
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /отличается от статуса/i);
});

test("stage_matches_column: этап QA + На проверке → PASS", () => {
  assert.equal(evaluate("На проверке", "этап QA").status, "PASS");
});

test("stageColumnCheckPasses: заполнен и не равен статусу", () => {
  const task = {
    ...emptyRawTask(),
    boardId: "999",
    status: "В процессе",
    stage: "Любая воронка",
  };
  assert.equal(stageColumnCheckPasses(task), true);
});
