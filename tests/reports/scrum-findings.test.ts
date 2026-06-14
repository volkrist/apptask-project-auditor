import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditResult } from "../../src/rules/rule-types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import {
  buildScrumEstimateMarkdown,
  computeScrumIssueCounts,
} from "../../src/reports/scrum-findings.js";

test("computeScrumIssueCounts aggregates scrum rules", () => {
  const cards: AuditResult["cards"] = [
    {
      task: { ...emptyRawTask(), id: "1", boardId: "783", title: "A" },
      results: [
        { ruleId: "scrum_task_in_estimate", status: "FAIL", reason: "x" },
        { ruleId: "scrum_title_matches_estimate", status: "WARN", reason: "y" },
      ],
    },
    {
      task: { ...emptyRawTask(), id: "2", boardId: "783", title: "B" },
      results: [
        { ruleId: "scrum_planned_hours_present", status: "WARN", reason: "z" },
      ],
    },
  ];
  const counts = computeScrumIssueCounts(cards);
  assert.equal(counts.scrumEstimateMissing, 1);
  assert.equal(counts.scrumNameMismatch, 1);
  assert.equal(counts.pvMissing, 1);
});

test("buildScrumEstimateMarkdown shows skip when sheets unavailable", () => {
  const result: AuditResult = {
    meta: {
      projectName: "P",
      boardUrl: "u",
      auditedAt: "2026-01-01",
      cardsChecked: 0,
      failCount: 0,
      warnCount: 0,
      scrumEstimateLoaded: false,
      scrumLoadError: "credentials not configured",
    },
    topIssues: [],
    cards: [],
  };
  const md = buildScrumEstimateMarkdown(result).join("\n");
  assert.match(md, /## Scrum \/ Смета/);
  assert.match(md, /пропущены/i);
});

test("buildScrumEstimateMarkdown lists violations", () => {
  const result: AuditResult = {
    meta: {
      projectName: "P",
      boardUrl: "u",
      auditedAt: "2026-01-01",
      cardsChecked: 1,
      failCount: 1,
      warnCount: 0,
      scrumEstimateLoaded: true,
      issueCounts: {
        deadlineIssues: 0,
        staleInProgressIssues: 0,
        staleReviewIssues: 0,
        testingQueueIssues: 0,
        criticalNoMovementIssues: 0,
        commentIssues: 0,
        scrumEstimateMissing: 1,
        scrumNameMismatch: 0,
        pvMissing: 0,
        decompositionMissing: 0,
      },
    },
    topIssues: [],
    cards: [
      {
        task: {
          ...emptyRawTask(),
          id: "1",
          boardId: "783",
          url: "u",
          title: "Missing",
        },
        results: [
          {
            ruleId: "scrum_task_in_estimate",
            status: "FAIL",
            reason: "не найдена",
          },
        ],
      },
    ],
  };
  const md = buildScrumEstimateMarkdown(result).join("\n");
  assert.match(md, /Не найдено в утверждённой смете/);
});
