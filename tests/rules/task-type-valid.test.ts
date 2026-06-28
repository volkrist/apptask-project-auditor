import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { extractTaskType } from "../../src/rules/helpers.js";
import { taskTypeValidRule } from "../../src/rules/hard/task-type-valid.js";

const config = loadAuditConfig();

function evaluate(overrides: { tags?: string[]; category?: string | null }) {
  const task = {
    ...emptyRawTask(),
    tags: overrides.tags ?? [],
    category: overrides.category ?? null,
  };
  return taskTypeValidRule.evaluate(task, { config, allTasks: [task] });
}

test("extractTaskType: тег «доработка» → доработка", () => {
  const task = { ...emptyRawTask(), tags: ["доработка"], category: "Frontend" };
  assert.equal(extractTaskType(task, config), "доработка");
});

test("extractTaskType: колонка Frontend без типового тега → null", () => {
  const task = {
    ...emptyRawTask(),
    tags: ["Описание есть"],
    category: "Frontend",
  };
  assert.equal(extractTaskType(task, config), null);
});

test("task_type_valid: TurboWeave-подобная карточка без типового тега → FAIL", () => {
  const r = evaluate({ tags: ["Описание есть", "пруф есть"], category: "Frontend" });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /баг, доработка/);
  assert.match(r.reason, /Frontend/);
  assert.match(r.reason, /не считается типом/i);
});

test("task_type_valid: тег «баг» → PASS", () => {
  assert.equal(evaluate({ tags: ["баг"], category: "Frontend" }).status, "PASS");
});

test("task_type_valid: категория «Найм» без тега → PASS", () => {
  assert.equal(evaluate({ tags: [], category: "Найм" }).status, "PASS");
});
