import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRuleCandidateAccount } from "../../src/reports/rule-candidate-accounting.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

function baseResult(cards: AuditResult["cards"]): AuditResult {
  return {
    meta: {
      projectName: "Test",
      boardUrl: "https://example.com",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: cards.length,
      failCount: 0,
      warnCount: 0,
      auditProfile: "contract_turboweave_v1",
    },
    topIssues: [],
    cards,
  };
}

test("high priority stale reports zero candidates when none match", () => {
  const account = buildRuleCandidateAccount(
    "high_priority_stale",
    baseResult([
      {
        task: {
          id: "1",
          url: null,
          title: "Task",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: "Normal",
          status: "В работе",
          tags: [],
          creator: null,
          assignees: ["Dev"],
          assigneeRefs: [],
          category: null,
          stage: null,
          plannedTime: null,
          actualTime: null,
          links: [],
          attachments: [],
          comments: [],
          boardId: "783",
        },
        results: [
          {
            ruleId: "high_priority_stale",
            status: "NOT_APPLICABLE",
            reason: "Не high/critical/bug",
          },
        ],
      },
    ]),
  );
  assert.equal(account.candidatesLabel, "0 high priority / critical bug");
  assert.equal(account.outcome, "OK");
  assert.doesNotMatch(account.candidatesLabel, /в области — все прошли/);
});

test("review assignee reports zero on-review candidates", () => {
  const account = buildRuleCandidateAccount(
    "review_stage_requires_assignee",
    baseResult([
      {
        task: {
          id: "1",
          url: null,
          title: "Task",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: "В работе",
          tags: [],
          creator: null,
          assignees: ["Dev"],
          assigneeRefs: [],
          category: null,
          stage: null,
          plannedTime: null,
          actualTime: null,
          links: [],
          attachments: [],
          comments: [],
          boardId: "783",
        },
        results: [
          {
            ruleId: "review_stage_requires_assignee",
            status: "NOT_APPLICABLE",
            reason: "Не на этапе проверки",
          },
        ],
      },
    ]),
  );
  assert.equal(account.candidatesLabel, "0 задач на проверке / QA");
  assert.doesNotMatch(account.candidatesLabel, /64/);
});

test("scrum PV partial when tasks missing from estimate", () => {
  const account = buildRuleCandidateAccount(
    "scrum_planned_hours_present",
    baseResult([
      {
        task: {
          id: "63",
          url: null,
          title: "Missing",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: "В работе",
          tags: [],
          creator: null,
          assignees: ["Dev"],
          assigneeRefs: [],
          category: null,
          stage: null,
          plannedTime: null,
          actualTime: null,
          links: [],
          attachments: [],
          comments: [],
          boardId: "783",
        },
        results: [
          {
            ruleId: "scrum_planned_hours_present",
            status: "SKIP",
            reason: "Нет строки сметы — ПВ не проверялось",
          },
          {
            ruleId: "scrum_task_in_estimate",
            status: "WARN",
            reason: "Задача не найдена в утверждённой смете по текущей логике сопоставления",
          },
        ],
      },
      {
        task: {
          id: "64",
          url: null,
          title: "In estimate",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: "В работе",
          tags: [],
          creator: null,
          assignees: ["Dev"],
          assigneeRefs: [],
          category: null,
          stage: null,
          plannedTime: null,
          actualTime: null,
          links: [],
          attachments: [],
          comments: [],
          boardId: "783",
        },
        results: [
          {
            ruleId: "scrum_planned_hours_present",
            status: "PASS",
            reason: "ПВ указано",
          },
        ],
      },
    ]),
  );
  assert.match(account.candidatesLabel, /1 в Scrum/);
  assert.match(account.candidatesLabel, /не в смете: 1/);
  assert.equal(account.outcome, "PARTIAL");
  assert.doesNotMatch(account.candidatesLabel, /все прошли/);
});

test("estimate_exceeded_without_comment counts only overrun tasks as candidates", () => {
  const account = buildRuleCandidateAccount(
    "estimate_exceeded_without_comment",
    baseResult([
      {
        task: {
          id: "1",
          url: null,
          title: "Over",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: "Завершено",
          tags: [],
          creator: null,
          assignees: [],
          assigneeRefs: [],
          category: null,
          stage: null,
          plannedTime: "10 ч",
          actualTime: null,
          links: [],
          attachments: [],
          comments: [],
          boardId: "783",
        },
        results: [
          {
            ruleId: "actual_hours_exceeds_estimate",
            status: "WARN",
            reason: "Факт 15.00 ч > ПВ 10 ч (карточка, +20%) — перерасход 50.0%",
          },
          {
            ruleId: "estimate_exceeded_without_comment",
            status: "WARN",
            reason: "Перерасход > 20% без объясняющего комментария",
          },
        ],
      },
      {
        task: {
          id: "2",
          url: null,
          title: "OK",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: "Завершено",
          tags: [],
          creator: null,
          assignees: [],
          assigneeRefs: [],
          category: null,
          stage: null,
          plannedTime: "10 ч",
          actualTime: null,
          links: [],
          attachments: [],
          comments: [],
          boardId: "783",
        },
        results: [
          {
            ruleId: "actual_hours_exceeds_estimate",
            status: "PASS",
            reason: "Факт 8.00 ч ≤ ПВ 10 ч (карточка, +20%)",
          },
          {
            ruleId: "estimate_exceeded_without_comment",
            status: "PASS",
            reason: "Перерасход ниже порога",
          },
        ],
      },
    ]),
  );
  assert.match(account.candidatesLabel, /1 с превышением без комментария/);
  assert.equal(account.warn, 1);
  assert.equal(account.outcome, "WARN");
});
