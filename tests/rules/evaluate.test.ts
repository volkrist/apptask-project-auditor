import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { evaluateProject, evaluateTask } from "../../src/rules/evaluate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const testConfig = loadAuditConfig({ linkCheckEnabled: false });
const legacyExtras = { auditProfileId: "legacy_generic" };

function loadFixture(name: string): RawTask {
  const path = join(__dirname, "..", "fixtures", name);
  return JSON.parse(readFileSync(path, "utf8")) as RawTask;
}

function statusOf(
  results: Awaited<ReturnType<typeof evaluateTask>>,
  ruleId: string,
): string | undefined {
  return results.find((r) => r.ruleId === ruleId)?.status;
}

test("evaluateTask legacy: хорошая карточка без критичных FAIL", async () => {
  const task = loadFixture("task-good.json");
  const results = await evaluateTask(task, testConfig, [task], undefined, legacyExtras);

  assert.equal(statusOf(results, "title_present"), "PASS");
  assert.equal(statusOf(results, "assignee_present"), "PASS");
  assert.equal(statusOf(results, "deadline_present"), "PASS");
  assert.equal(statusOf(results, "priority_present"), "PASS");
  assert.equal(statusOf(results, "deadline_not_overdue"), "PASS");
  assert.equal(statusOf(results, "description_has_goal"), "PASS");
  assert.equal(statusOf(results, "artifact_links_present"), "PASS");
});

test("evaluateTask legacy: плохая карточка с FAIL по жёстким правилам", async () => {
  const task = loadFixture("task-bad.json");
  const results = await evaluateTask(task, testConfig, [task], undefined, legacyExtras);

  assert.equal(statusOf(results, "title_present"), "FAIL");
  assert.equal(statusOf(results, "title_not_generic"), "FAIL");
  assert.equal(statusOf(results, "assignee_present"), "FAIL");
  assert.equal(statusOf(results, "priority_present"), "FAIL");
  assert.equal(statusOf(results, "deadline_not_overdue"), "FAIL");
  assert.equal(statusOf(results, "description_present"), "FAIL");
  assert.equal(statusOf(results, "description_has_goal"), "FAIL");
  assert.equal(statusOf(results, "links_reachable"), "FAIL");
  assert.equal(statusOf(results, "estimate_present"), "FAIL");
});

test("evaluateTask legacy: tags_required FAIL если теги пустые", async () => {
  const task = loadFixture("task-bad.json");
  const results = await evaluateTask(task, testConfig, [task], undefined, legacyExtras);
  assert.equal(statusOf(results, "tags_required"), "FAIL");
});

test("evaluateTask legacy: tags_required PASS если есть тег", async () => {
  const task = loadFixture("task-good.json");
  const results = await evaluateTask(task, testConfig, [task], undefined, legacyExtras);
  assert.equal(statusOf(results, "tags_required"), "PASS");
});

test("evaluateProject legacy: агрегирует счётчики", async () => {
  const good = loadFixture("task-good.json");
  const bad = loadFixture("task-bad.json");
  const project = await evaluateProject([good, bad], testConfig, undefined, legacyExtras);

  assert.equal(project.cards.length, 2);
  assert.ok(project.failCount > 0);
  assert.ok(project.warnCount > 0);
});

test("evaluateTask contract: включает обязательные поля карточки", async () => {
  const task = loadFixture("task-bad.json");
  const results = await evaluateTask(task, testConfig, [task]);
  assert.equal(statusOf(results, "deadline_present"), "PASS");
  assert.equal(statusOf(results, "artifact_links_present"), "FAIL");
  assert.equal(statusOf(results, "assignee_present"), "FAIL");
});

test("evaluateProject contract: исключает потоковые карточки", async () => {
  const flow: RawTask = {
    ...loadFixture("task-good.json"),
    id: "9",
    title: "Менеджмент (PM)",
  };
  const dev: RawTask = {
    ...loadFixture("task-good.json"),
    id: "10",
    title: "API endpoint",
  };
  const project = await evaluateProject([flow, dev], testConfig);
  assert.equal(project.cards.length, 1);
  assert.equal(project.meta.excludedFlowTasks, 1);
});

test("not_duplicate legacy: похожие названия на доске", async () => {
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
  const results = await evaluateTask(a, testConfig, [a, b], undefined, legacyExtras);
  assert.equal(statusOf(results, "not_duplicate"), "WARN");
});
