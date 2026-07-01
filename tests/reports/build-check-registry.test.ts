import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTRACT_OPERATIONAL_CHECK_REGISTRY,
  getFullCheckRegistry,
  MANDATORY_CARD_FIELD_CHECK_REGISTRY,
} from "../../src/config/contract-check-registry.js";
import {
  buildCheckRegistryRows,
  summarizeCheckRegistry,
} from "../../src/reports/build-check-registry.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

test("full check registry has mandatory + operational items", () => {
  assert.equal(MANDATORY_CARD_FIELD_CHECK_REGISTRY.length, 22);
  assert.equal(CONTRACT_OPERATIONAL_CHECK_REGISTRY.length, 45);
  assert.equal(getFullCheckRegistry().length, 61);
});

test("registry marks skipped entity rule", () => {
  const result: AuditResult = {
    meta: {
      projectName: "Test",
      boardUrl: "https://example.com",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 1,
      failCount: 0,
      warnCount: 0,
      auditProfile: "contract_turboweave_v1",
      skipRuleSummaries: [
        {
          ruleId: "team_worksheet_match",
          label: "Команда",
          count: 1,
          sampleReason: "рабочая таблица проекта не подключена",
        },
      ],
    },
    topIssues: [],
    cards: [],
    entityFindings: [
      {
        ruleId: "team_worksheet_match",
        status: "SKIP",
        reason: "рабочая таблица проекта не подключена",
        scope: "team",
        objectLabel: "команда проекта",
      },
    ],
  };

  const rows = buildCheckRegistryRows(result);
  const teamRow = rows.find((r) => r.entry.ruleIds[0] === "team_worksheet_match");
  assert.equal(teamRow?.executionStatus, "SKIP");
  assert.equal(teamRow?.resultText, "SKIP");

  const notAuto = rows.filter((r) => r.executionStatus === "NOT_APPLICABLE");
  assert.equal(notAuto.length, 0);
});

test("registry counts task-level violations", () => {
  const result: AuditResult = {
    meta: {
      projectName: "Test",
      boardUrl: "https://example.com",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 2,
      failCount: 2,
      warnCount: 0,
      auditProfile: "contract_turboweave_v1",
    },
    topIssues: [],
    cards: [
      {
        task: {
          id: "1",
          url: null,
          title: "A",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: null,
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
          { ruleId: "assignee_present", status: "FAIL", reason: "Нет исполнителя" },
        ],
      },
      {
        task: {
          id: "2",
          url: null,
          title: "B",
          descriptionText: null,
          createdAt: null,
          startDate: null,
          dueDate: null,
          priority: null,
          status: null,
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
          { ruleId: "assignee_present", status: "FAIL", reason: "Нет исполнителя" },
        ],
      },
    ],
  };

  const row = buildCheckRegistryRows(result).find(
    (r) => r.entry.ruleIds[0] === "assignee_present",
  );
  assert.equal(row?.executionStatus, "CHECKED");
  assert.equal(row?.failCount, 2);
  assert.equal(row?.violations, "2 FAIL");
});

test("summarizeCheckRegistry totals", () => {
  const rows = buildCheckRegistryRows({
    meta: {
      projectName: "Test",
      boardUrl: "https://example.com",
      auditedAt: "2026-06-10T12:00:00Z",
      cardsChecked: 0,
      failCount: 0,
      warnCount: 0,
      auditProfile: "contract_turboweave_v1",
    },
    topIssues: [],
    cards: [],
    entityFindings: [
      {
        ruleId: "task_type_classification",
        status: "PASS",
        reason: "ok",
        scope: "project",
        objectLabel: "классификация",
      },
    ],
  });
  const s = summarizeCheckRegistry(rows);
  assert.equal(s.checked + s.notApplicable + s.skip, 61);
  assert.equal(s.notApplicable, 0);
});
