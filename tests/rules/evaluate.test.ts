import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { auditConfig } from "../../src/config/audit-config.js";
import { evaluateProject, evaluateTask } from "../../src/rules/evaluate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): RawTask {
  const path = join(__dirname, "..", "fixtures", name);
  return JSON.parse(readFileSync(path, "utf8")) as RawTask;
}

function statusOf(
  results: ReturnType<typeof evaluateTask>,
  ruleId: string,
): string | undefined {
  return results.find((r) => r.ruleId === ruleId)?.status;
}

test("evaluateTask: хорошая карточка без критичных FAIL", () => {
  const task = loadFixture("task-good.json");
  const results = evaluateTask(task, auditConfig, [task]);

  assert.equal(statusOf(results, "title_present"), "PASS");
  assert.equal(statusOf(results, "assignee_present"), "PASS");
  assert.equal(statusOf(results, "deadline_present"), "PASS");
  assert.equal(statusOf(results, "priority_present"), "PASS");
  assert.equal(statusOf(results, "deadline_not_overdue"), "PASS");
});

test("evaluateTask: плохая карточка с FAIL по жёстким правилам", () => {
  const task = loadFixture("task-bad.json");
  const results = evaluateTask(task, auditConfig, [task]);

  assert.equal(statusOf(results, "title_present"), "PASS");
  assert.equal(statusOf(results, "assignee_present"), "FAIL");
  assert.equal(statusOf(results, "priority_present"), "FAIL");
  assert.equal(statusOf(results, "deadline_not_overdue"), "FAIL");
  assert.equal(statusOf(results, "description_present"), "FAIL");
  assert.equal(statusOf(results, "links_reachable"), "FAIL");
});

test("evaluateTask: субъективные правила дают WARN", () => {
  const task = loadFixture("task-bad.json");
  const results = evaluateTask(task, auditConfig, [task]);

  assert.equal(statusOf(results, "title_not_generic"), "WARN");
  assert.equal(statusOf(results, "description_has_goal"), "WARN");
  assert.equal(statusOf(results, "estimate_present"), "WARN");
});

test("evaluateProject: агрегирует счётчики", () => {
  const good = loadFixture("task-good.json");
  const bad = loadFixture("task-bad.json");
  const project = evaluateProject([good, bad], auditConfig);

  assert.equal(project.cards.length, 2);
  assert.ok(project.failCount > 0);
  assert.ok(project.warnCount > 0);
});

test("not_duplicate: похожие названия на доске", () => {
  const a: RawTask = {
    ...loadFixture("task-good.json"),
    id: "1",
    title: "Отчёт по найму май",
  };
  const b: RawTask = {
    ...loadFixture("task-good.json"),
    id: "2",
    title: "Отчёт по найму за май",
  };
  const results = evaluateTask(a, auditConfig, [a, b]);
  assert.equal(statusOf(results, "not_duplicate"), "WARN");
});
