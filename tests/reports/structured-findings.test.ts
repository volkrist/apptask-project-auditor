import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditResult } from "../../src/rules/rule-types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import {
  buildStatusDeadlineMarkdown,
  buildTestingQueueMarkdown,
  computeIssueCounts,
} from "../../src/reports/structured-findings.js";
import { buildHumanAuditMarkdown } from "../../src/reports/human-audit-markdown.js";

test("computeIssueCounts aggregates categories", () => {
  const cards: AuditResult["cards"] = [
    {
      task: {
        ...emptyRawTask(),
        id: "1",
        boardId: "54",
        status: "В работе",
        dueDate: "01.01.2020",
      },
      results: [
        { ruleId: "deadline_less_than_one_day", status: "FAIL", reason: "x" },
        { ruleId: "in_progress_stale", status: "WARN", reason: "y" },
      ],
    },
    {
      task: { ...emptyRawTask(), id: "2", boardId: "54", status: "На проверке" },
      results: [
        { ruleId: "review_stale", status: "WARN", reason: "z" },
        { ruleId: "vague_done_comment", status: "WARN", reason: "v" },
      ],
    },
  ];
  const counts = computeIssueCounts(cards, {
    reviewQueueCount: 12,
    reviewQueueMax: 10,
    byBoard: {
      "54": {
        boardId: "54",
        testingQueueCount: 12,
        testingQueueMax: 10,
        sampleTasks: [{ id: "2", url: "u", title: "t" }],
      },
    },
  });
  assert.equal(counts.deadlineIssues, 1);
  assert.equal(counts.staleInProgressIssues, 1);
  assert.equal(counts.staleReviewIssues, 1);
  assert.equal(counts.commentIssues, 1);
});

test("markdown sections render structured headings", () => {
  const result: AuditResult = {
    meta: {
      projectName: "P",
      boardUrl: "https://apptask.ru/c/7/board/54",
      auditedAt: "2026-01-01",
      cardsChecked: 1,
      failCount: 1,
      warnCount: 0,
      issueCounts: {
        deadlineIssues: 1,
        staleInProgressIssues: 0,
        staleReviewIssues: 0,
        testingQueueIssues: 1,
        criticalNoMovementIssues: 0,
        commentIssues: 0,
      },
      boardMetrics: {
        reviewQueueCount: 11,
        reviewQueueMax: 10,
        byBoard: {
          "54": {
            boardId: "54",
            testingQueueCount: 11,
            testingQueueMax: 10,
            sampleTasks: [{ id: "1", url: "u", title: "Task" }],
          },
        },
      },
    },
    topIssues: [],
    cards: [
      {
        task: {
          ...emptyRawTask(),
          id: "1",
          boardId: "54",
          url: "u",
          title: "Task",
          status: "В работе",
          dueDate: "01.01.2020",
        },
        results: [
          {
            ruleId: "deadline_less_than_one_day",
            status: "FAIL",
            reason: "просрочено",
          },
        ],
      },
    ],
  };

  const statusMd = buildStatusDeadlineMarkdown(result).join("\n");
  assert.match(statusMd, /## Сроки и статусы/);
  assert.match(statusMd, /Дедлайн/);

  const queueMd = buildTestingQueueMarkdown(result).join("\n");
  assert.match(queueMd, /## Очередь тестирования/);

  const human = buildHumanAuditMarkdown(result);
  assert.match(human, /### Сводка по новым проверкам/);
  assert.match(human, /## Сроки и статусы/);
  assert.match(human, /## Очередь тестирования/);
});
