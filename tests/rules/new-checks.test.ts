import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { evaluateTask } from "../../src/rules/evaluate.js";
import type { AppTaskUser } from "../../src/users/app-task-users.js";

const baseConfig = loadAuditConfig({ linkCheckEnabled: false });
const RULE_UNRESOLVED = "unresolved_question_keywords_in_card";
const RULE_REVIEW = "review_stage_requires_assignee";

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

const sampleUsers: AppTaskUser[] = [
  {
    id: 1,
    realName: "Иван Иванов",
    email: "i@test.ru",
    blocked: false,
    roleUser: "Backend разработчик",
  },
  {
    id: 2,
    realName: "Петр Петров",
    email: "p@test.ru",
    blocked: false,
    roleUser: "QA инженер",
  },
];

test("unresolved_question: keyword в title → FAIL", async () => {
  const t = task({
    title: "Нужно уточнить сроки",
    descriptionText: "Цель: релиз.",
    assignees: ["Иван"],
  });
  const results = await evaluateTask(t, baseConfig, [t]);
  assert.equal(statusOf(results, RULE_UNRESOLVED), "FAIL");
  assert.match(reasonOf(results, RULE_UNRESOLVED) ?? "", /названии/i);
  assert.match(reasonOf(results, RULE_UNRESOLVED) ?? "", /уточнить/i);
});

test("unresolved_question: keyword в descriptionText → FAIL", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Нужно уточнить сроки релиза",
    assignees: ["Иван"],
  });
  const results = await evaluateTask(t, baseConfig, [t]);
  assert.equal(statusOf(results, RULE_UNRESOLVED), "FAIL");
  assert.match(reasonOf(results, RULE_UNRESOLVED) ?? "", /описании/i);
});

test("unresolved_question: keyword в comments[].text → FAIL", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: релиз.",
    comments: [{ text: "Ждем ответ от заказчика" }],
    assignees: ["Иван"],
  });
  const results = await evaluateTask(t, baseConfig, [t]);
  assert.equal(statusOf(results, RULE_UNRESOLVED), "FAIL");
  assert.match(reasonOf(results, RULE_UNRESOLVED) ?? "", /комментарии/i);
});

test("unresolved_question: без keyword → PASS", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: сделать отчёт. Ожидаемый результат — файл в папке.",
    assignees: ["Иван"],
  });
  const results = await evaluateTask(t, baseConfig, [t]);
  assert.equal(statusOf(results, RULE_UNRESOLVED), "PASS");
});

test("unresolved_question: «ждём ответ» и «ждем ответ» → FAIL", async () => {
  const t1 = task({
    title: "Задача",
    descriptionText: "Ждём ответ по ТЗ",
    assignees: ["Иван"],
  });
  const r1 = await evaluateTask(t1, baseConfig, [t1]);
  assert.equal(statusOf(r1, RULE_UNRESOLVED), "FAIL");
  assert.match(reasonOf(r1, RULE_UNRESOLVED) ?? "", /ждём ответ/i);

  const t2 = task({
    title: "Задача",
    descriptionText: "Ждем ответ от клиента",
    assignees: ["Иван"],
  });
  const r2 = await evaluateTask(t2, baseConfig, [t2]);
  assert.equal(statusOf(r2, RULE_UNRESOLVED), "FAIL");
  assert.match(reasonOf(r2, RULE_UNRESOLVED) ?? "", /ждем ответ/i);
});

test("review_stage: На проверке, assignees=[] → FAIL", async () => {
  const t = task({
    title: "Задача",
    descriptionText: "Цель: проверить модуль.",
    status: "На проверке",
    stage: "этап",
    assignees: [],
  });
  const results = await evaluateTask(t, baseConfig, [t]);
  assert.equal(statusOf(results, RULE_REVIEW), "FAIL");
  assert.match(
    reasonOf(results, RULE_REVIEW) ?? "",
    /исполнитель\/тестировщик не назначен/i,
  );
});

test("review_stage: На проверке, assignees=[Иван], QA_TESTERS пуст, users без QA role → PASS", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: false, qaTesters: [] });
  const usersNoQa: AppTaskUser[] = [
    {
      id: 1,
      realName: "Иван",
      blocked: false,
      roleUser: "Backend разработчик",
    },
  ];
  const t = task({
    title: "Задача",
    descriptionText: "Цель: проверить модуль.",
    status: "На проверке",
    assignees: ["Иван"],
  });
  const results = await evaluateTask(t, config, [t], usersNoQa);
  assert.equal(statusOf(results, RULE_REVIEW), "PASS");
  assert.match(
    reasonOf(results, RULE_REVIEW) ?? "",
    /QA-список не задан/i,
  );
});

test("review_stage: На проверке, assignees=[Иван], QA_TESTERS=Петр → FAIL", async () => {
  const config = loadAuditConfig({
    linkCheckEnabled: false,
    qaTesters: ["Петр"],
  });
  const t = task({
    title: "Задача",
    descriptionText: "Цель: проверить модуль.",
    status: "На проверке",
    assignees: ["Иван"],
  });
  const results = await evaluateTask(t, config, [t], sampleUsers);
  assert.equal(statusOf(results, RULE_REVIEW), "FAIL");
  assert.match(
    reasonOf(results, RULE_REVIEW) ?? "",
    /нет тестировщика/i,
  );
});

test("review_stage: На проверке, assignees=[Петр], QA_TESTERS=Петр → PASS", async () => {
  const config = loadAuditConfig({
    linkCheckEnabled: false,
    qaTesters: ["Петр"],
  });
  const t = task({
    title: "Задача",
    descriptionText: "Цель: проверить модуль.",
    status: "На проверке",
    assignees: ["Петр"],
  });
  const results = await evaluateTask(t, config, [t], sampleUsers);
  assert.equal(statusOf(results, RULE_REVIEW), "PASS");
});

test("review_stage: userId + roleUser QA → PASS", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: false, qaTesters: [] });
  const t = task({
    title: "Задача",
    descriptionText: "Цель: проверить.",
    status: "На проверке",
    assigneeRefs: [{ name: "Петр Петров", userId: "2" }],
    assignees: ["Петр Петров"],
  });
  const results = await evaluateTask(t, config, [t], sampleUsers);
  assert.equal(statusOf(results, RULE_REVIEW), "PASS");
});

test("review_stage: userId Backend → FAIL при users API с QA roles", async () => {
  const config = loadAuditConfig({ linkCheckEnabled: false, qaTesters: [] });
  const t = task({
    title: "Задача",
    descriptionText: "Цель: проверить.",
    status: "На проверке",
    assigneeRefs: [{ name: "Иван Иванов", userId: "1" }],
    assignees: ["Иван Иванов"],
  });
  const results = await evaluateTask(t, config, [t], sampleUsers);
  assert.equal(statusOf(results, RULE_REVIEW), "FAIL");
});

test("review_stage: status не review → PASS", async () => {
  const config = loadAuditConfig({
    linkCheckEnabled: false,
    qaTesters: ["Петр"],
  });
  const t = task({
    title: "Задача",
    descriptionText: "Цель: работа.",
    status: "В процессе",
    assignees: [],
  });
  const results = await evaluateTask(t, config, [t], sampleUsers);
  assert.equal(statusOf(results, RULE_REVIEW), "PASS");
});
