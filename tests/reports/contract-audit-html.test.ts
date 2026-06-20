import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContractAuditHtml } from "../../src/reports/build-html-report.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

function baseResult(overrides: Partial<AuditResult["meta"]> = {}): AuditResult {
  return {
    meta: {
      projectName: "TurboWeave",
      boardUrl: "https://apptask.ru/c/7/board/783",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 3,
      failCount: 1,
      warnCount: 2,
      auditProfile: "contract_turboweave_v1",
      excludedFlowTasks: 2,
      totalTasksOnBoard: 5,
      sourcesUsed: ["AppTask DB"],
      ...overrides,
    },
    topIssues: [],
    cards: [
      {
        task: {
          id: "65",
          url: "https://apptask.ru/c/7/board/783/65",
          title: "UI task",
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
          { ruleId: "assignee_present", status: "PASS", reason: "ok" },
          {
            ruleId: "ui_has_mockup_link",
            status: "FAIL",
            reason: "Нет ссылки на актуальный макет",
          },
        ],
      },
    ],
  };
}

test("buildContractAuditHtml includes toc, registry and violation toggles", () => {
  const html = buildContractAuditHtml(baseResult());
  assert.match(html, /<title>AppTask Audit Report — TurboWeave<\/title>/);
  assert.match(html, /id="toc"/);
  assert.match(html, /Оглавление/);
  assert.match(html, /Проверок OK:/);
  assert.match(html, /Проверок с нарушениями:/);
  assert.match(html, /data-toggle=/);
  assert.match(html, /counter-btn fail/);
  assert.match(html, /Метод проверки:/);
  assert.match(html, /id="classification"/);
  assert.match(html, /Классификация задач/);
  assert.match(html, /Реестр проверок/);
  assert.doesNotMatch(html, /counter-btn ok/);
  assert.doesNotMatch(html, /Рекомендация/);
});

test("buildContractAuditHtml renders violation details with card link", () => {
  const html = buildContractAuditHtml(baseResult());
  assert.match(html, /apptask\.ru\/c\/7\/board\/783\/65/);
  assert.match(html, /Нет ссылки на актуальный макет/);
  assert.match(html, /violation-card/);
});

test("buildContractAuditHtml includes search filter script", () => {
  const html = buildContractAuditHtml(baseResult());
  assert.match(html, /id="report-search"/);
  assert.match(html, /data-toggle/);
});
