import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRegistryRowFromEvidence } from "../../src/reports/evidence-registry-bridge.js";
import { CONTRACT_CHECK_REGISTRY } from "../../src/config/contract-check-registry.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

function baseResult(cards: AuditResult["cards"]): AuditResult {
  return {
    meta: {
      projectName: "Test",
      boardUrl: "https://apptask.ru/c/7/board/783",
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

test("deadline registry row uses zero candidates label", () => {
  const entry = CONTRACT_CHECK_REGISTRY.find((e) => e.num === 1)!;
  const cards = Array.from({ length: 3 }, (_, i) => ({
    task: {
      id: String(i + 1),
      url: null,
      title: "Task",
      descriptionText: null,
      createdAt: null,
      startDate: null,
      dueDate: "2026-12-01",
      priority: null,
      status: "В работе",
      tags: [],
      creator: null,
      assignees: [],
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
      { ruleId: "deadline_less_than_one_day", status: "PASS" as const, reason: "OK" },
    ],
  }));
  const row = buildRegistryRowFromEvidence(entry, baseResult(cards));
  assert.match(row.candidates, /0 задач с дедлайном < 1 дня|Кандидатов для проверки нет/);
  assert.equal(row.evidence?.candidateCount, 0);
});

test("scrum PV registry row exposes notChecked evidence", () => {
  const entry = CONTRACT_CHECK_REGISTRY.find((e) => e.num === 13)!;
  const row = buildRegistryRowFromEvidence(
    entry,
    baseResult([
      {
        task: {
          id: "63",
          url: "https://apptask.ru/c/7/board/783/63",
          title: "Конкурентный анализ",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: "В работе",
          tags: [],
          creator: null,
          assignees: [],
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
        ],
      },
    ]),
  );
  assert.equal(row.outcome, "PARTIAL");
  assert.ok(row.evidence?.notCheckedCount ?? 0 > 0);
  assert.match(row.unavailable, /не проверено|сметы/);
});
