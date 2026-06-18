import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContractAuditMarkdown } from "../../src/reports/contract-audit-markdown.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

test("contract report has no главные проблемы section", () => {
  const result: AuditResult = {
    meta: {
      projectName: "TurboWeave",
      boardUrl: "https://apptask.ru/c/7/board/783",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 10,
      failCount: 1,
      warnCount: 0,
      auditProfile: "contract_turboweave_v1",
      excludedFlowTasks: 2,
      sourcesUsed: ["AppTask DB"],
    },
    topIssues: [],
    cards: [
      {
        task: {
          id: "100",
          url: "https://apptask.ru/c/7/board/783/100",
          title: "Test task",
          descriptionText: "desc",
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
            ruleId: "in_progress_stale",
            status: "WARN",
            reason: "stale",
          },
        ],
      },
    ],
  };

  const md = buildContractAuditMarkdown(result);
  assert.match(md, /# Отчёт аудита AppTask/);
  assert.match(md, /Исключено потоковых\/сервисных карточек: 2/);
  assert.doesNotMatch(md, /Главные проблемы/i);
  assert.doesNotMatch(md, /Что исправить в первую очередь/i);
  assert.doesNotMatch(md, /deadline_present/);
});
