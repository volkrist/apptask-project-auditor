import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBoardClassification,
  formatClassificationSummaryLine,
} from "../../src/reports/board-classification.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

function stubTask(id: string, title: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://apptask.ru/c/7/board/783/${id}`,
    title,
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
    ...extras,
  };
}

test("buildBoardClassification marks excluded cards as flow", () => {
  const result: AuditResult = {
    meta: {
      projectName: "Test",
      boardUrl: "https://apptask.ru/c/7/board/783",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 2,
      failCount: 0,
      warnCount: 0,
      auditProfile: "contract_turboweave_v1",
      excludedFlowTasks: 2,
      totalTasksOnBoard: 4,
      excludedFlowCards: [
        {
          id: "1",
          title: "Flow A",
          url: "https://apptask.ru/c/7/board/783/1",
          status: "Готово",
          assignee: "Ops",
        },
        {
          id: "2",
          title: "Flow B",
          url: "https://apptask.ru/c/7/board/783/2",
          status: "Готово",
          assignee: null,
        },
      ],
    },
    topIssues: [],
    cards: [
      {
        task: stubTask("3", "Regular task"),
        results: [],
      },
      {
        task: stubTask("4", "UI landing page", { tags: ["ui"] }),
        results: [],
      },
    ],
  };

  const { counts, rows } = buildBoardClassification(result);
  assert.equal(counts.total, 4);
  assert.equal(counts.flow, 2);
  assert.equal(rows.filter((r) => r.id === "1")[0]?.bucket, "flow");
  assert.equal(rows.filter((r) => r.id === "2")[0]?.bucket, "flow");
  assert.equal(rows.filter((r) => r.id === "1")[0]?.excludedFromCardAudit, true);
});

test("formatClassificationSummaryLine matches counts", () => {
  const line = formatClassificationSummaryLine({
    total: 79,
    flow: 15,
    ui: 18,
    regular: 46,
    unknown: 0,
  });
  assert.match(line, /потоковые 15/);
  assert.match(line, /UI\/front 18/);
  assert.match(line, /обычные 46/);
});
