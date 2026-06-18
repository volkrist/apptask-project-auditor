import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContractAuditMarkdown } from "../../src/reports/contract-audit-markdown.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

function baseResult(overrides: Partial<AuditResult["meta"]> = {}): AuditResult {
  return {
    meta: {
      projectName: "TurboWeave",
      boardUrl: "https://apptask.ru/c/7/board/783",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 3,
      failCount: 0,
      warnCount: 2,
      auditProfile: "contract_turboweave_v1",
      excludedFlowTasks: 2,
      totalTasksOnBoard: 5,
      sourcesUsed: ["AppTask DB", "Scrum"],
      ...overrides,
    },
    topIssues: [],
    cards: [],
  };
}

test("contract report uses auditor format with condition and full card list", () => {
  const cards = Array.from({ length: 20 }, (_, i) => ({
    task: {
      id: String(i + 1),
      url: `https://apptask.ru/c/7/board/783/${i + 1}`,
      title: `Task ${i + 1}`,
      descriptionText: null,
      createdAt: null,
      startDate: null,
      dueDate: null,
      priority: null,
      status: "Завершено",
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
        ruleId: "verified_success_comment",
        status: "WARN" as const,
        reason: "Нет комментария",
      },
    ],
  }));

  const md = buildContractAuditMarkdown({
    ...baseResult({ warnCount: 20 }),
    cards,
  });

  assert.match(md, /# Отчёт аудита AppTask/);
  assert.match(md, /#### Проверка:/);
  assert.match(md, /Условие:/);
  assert.match(md, /Результат: WARN/);
  assert.match(md, /№20/);
  assert.doesNotMatch(md, /и ещё/);
  assert.doesNotMatch(md, /Почему это важно/i);
  assert.doesNotMatch(md, /Что сделать/i);
  assert.doesNotMatch(md, /contract_turboweave_v1/);
});

test("excluded flow cards listed fully", () => {
  const excluded = Array.from({ length: 15 }, (_, i) => ({
    id: String(100 + i),
    title: `Flow ${i}`,
    url: `https://apptask.ru/c/7/board/783/${100 + i}`,
    status: "В работе",
    assignee: "PM",
  }));
  const md = buildContractAuditMarkdown(
    baseResult({ excludedFlowTasks: 15, excludedFlowCards: excluded }),
  );
  assert.match(md, /№114/);
  assert.doesNotMatch(md, /Примеры:/);
});

test("source skip block uses SKIP reason format", () => {
  const md = buildContractAuditMarkdown(
    baseResult({
      skipRuleSummaries: [
        {
          ruleId: "team_worksheet_match",
          label: "Команда",
          count: 64,
          sampleReason: "рабочая таблица проекта не подключена",
        },
      ],
    }),
  );
  assert.match(md, /## Не проверено автоматически/);
  assert.match(md, /Результат: SKIP/);
  assert.match(md, /Причина:/);
});
