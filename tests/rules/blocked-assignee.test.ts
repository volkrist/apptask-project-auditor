import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { evaluateTask } from "../../src/rules/evaluate.js";
import type { AppTaskUser } from "../../src/users/app-task-users.js";
import {
  findBlockedAssignees,
  findAssigneesMissingFromUsers,
} from "../../src/users/app-task-users.js";

const baseConfig = loadAuditConfig({ linkCheckEnabled: false });

const sampleUsers: AppTaskUser[] = [
  { id: 100, realName: "Активный Иван", email: "a@test.ru", blocked: false },
  { id: 200, realName: "Заблокированный Петр", email: "b@test.ru", blocked: true },
];

function statusOf(
  results: Awaited<ReturnType<typeof evaluateTask>>,
  ruleId: string,
): string | undefined {
  return results.find((r) => r.ruleId === ruleId)?.status;
}

function reasonOf(
  results: Awaited<ReturnType<typeof evaluateTask>>,
  ruleId: string,
): string | undefined {
  return results.find((r) => r.ruleId === ruleId)?.reason;
}

function task(overrides: Partial<RawTask>): RawTask {
  return { ...emptyRawTask(), ...overrides };
}

test("findBlockedAssignees: userId blocked:true → match userId", () => {
  const t = task({
    assigneeRefs: [{ name: "Петр", userId: "200" }],
    assignees: ["Петр"],
  });
  const hits = findBlockedAssignees(t, sampleUsers);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.matchBy, "userId");
  assert.equal(hits[0]!.user.id, 200);
});

test("findBlockedAssignees: name blocked:true → match name", () => {
  const t = task({
    assigneeRefs: [{ name: "Заблокированный Петр", userId: null }],
    assignees: ["Заблокированный Петр"],
  });
  const hits = findBlockedAssignees(t, sampleUsers);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.matchBy, "name");
});

test("findBlockedAssignees: userId blocked:false → no match", () => {
  const t = task({
    assigneeRefs: [{ name: "Иван", userId: "100" }],
    assignees: ["Иван"],
  });
  assert.equal(findBlockedAssignees(t, sampleUsers).length, 0);
});

test("findBlockedAssignees: assignee not in users → no match", () => {
  const t = task({
    assigneeRefs: [{ name: "Неизвестный", userId: "999" }],
    assignees: ["Неизвестный"],
  });
  assert.equal(findBlockedAssignees(t, sampleUsers).length, 0);
});

test("blocked_assignee: active userId → PASS", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: тест.",
    assigneeRefs: [{ name: "Активный Иван", userId: "100" }],
    assignees: ["Активный Иван"],
  });
  const results = await evaluateTask(t, baseConfig, [t], sampleUsers);
  assert.equal(statusOf(results, "blocked_assignee_not_allowed"), "PASS");
});

test("blocked_assignee: blocked userId → FAIL", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: тест.",
    assigneeRefs: [{ name: "Заблокированный Петр", userId: "200" }],
    assignees: ["Заблокированный Петр"],
  });
  const results = await evaluateTask(t, baseConfig, [t], sampleUsers);
  assert.equal(statusOf(results, "blocked_assignee_not_allowed"), "FAIL");
  assert.match(
    reasonOf(results, "blocked_assignee_not_allowed") ?? "",
    /заблокированного\/неактивного пользователя AppTask/i,
  );
  assert.match(
    reasonOf(results, "blocked_assignee_not_allowed") ?? "",
    /userId 200/i,
  );
});

test("blocked_assignee: blocked name → FAIL with name match note", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: тест.",
    assigneeRefs: [{ name: "Заблокированный Петр", userId: null }],
    assignees: ["Заблокированный Петр"],
  });
  const results = await evaluateTask(t, baseConfig, [t], sampleUsers);
  assert.equal(statusOf(results, "blocked_assignee_not_allowed"), "FAIL");
  assert.match(
    reasonOf(results, "blocked_assignee_not_allowed") ?? "",
    /по ФИО/i,
  );
});

test("blocked_assignee: assignee not in users → not FAIL", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: тест.",
    assigneeRefs: [{ name: "Чужой Человек", userId: null }],
    assignees: ["Чужой Человек"],
  });
  const results = await evaluateTask(t, baseConfig, [t], sampleUsers);
  assert.equal(statusOf(results, "blocked_assignee_not_allowed"), "PASS");
  assert.equal(findAssigneesMissingFromUsers(t, sampleUsers).length, 1);
});

test("blocked_assignee: empty users API → SKIP", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: тест.",
    assigneeRefs: [{ name: "Заблокированный Петр", userId: "200" }],
    assignees: ["Заблокированный Петр"],
  });
  const results = await evaluateTask(t, baseConfig, [t], []);
  assert.equal(statusOf(results, "blocked_assignee_not_allowed"), "SKIP");
});
