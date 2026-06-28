import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTRACT_RULE_EVIDENCE,
  getEvidenceSpecByRuleId,
  groupEvidenceByAutomationLevel,
} from "../../src/config/contract-rule-evidence.js";
import { getFullCheckRegistry } from "../../src/config/contract-check-registry.js";
import {
  formatEvidenceMatrixTable,
  formatFullEvidenceMatrixMarkdown,
} from "../../src/reports/format-evidence-matrix-markdown.js";
import {
  buildEvidenceResult,
  buildExampleEvidenceResults,
  EXAMPLE_EVIDENCE_RULE_IDS,
} from "../../src/reports/build-evidence-result.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

test("CONTRACT_RULE_EVIDENCE matches full check registry", () => {
  const registry = getFullCheckRegistry();
  assert.equal(CONTRACT_RULE_EVIDENCE.length, registry.length);
  assert.equal(registry.length, 62);
  for (let i = 0; i < registry.length; i++) {
    const reg = registry[i]!;
    const ev = CONTRACT_RULE_EVIDENCE[i]!;
    assert.equal(ev.num, reg.num);
    assert.equal(ev.title, reg.title);
    assert.deepEqual([...ev.ruleIds], [...reg.ruleIds]);
  }
});

test("every registry ruleId has evidence spec", () => {
  const ruleIds = new Set<string>();
  for (const entry of getFullCheckRegistry()) {
    for (const id of entry.ruleIds) ruleIds.add(id);
  }
  for (const id of ruleIds) {
    assert.ok(getEvidenceSpecByRuleId(id), `missing spec for ${id}`);
  }
});

test("automation level groups cover all checks", () => {
  const groups = groupEvidenceByAutomationLevel();
  const total = Object.values(groups).reduce((s, g) => s + g.length, 0);
  assert.equal(total, 62);
  assert.ok(groups.STRICT.length > 0);
  assert.ok(groups.TEXT_MARKER.length > 0);
  assert.ok(groups.PARTIAL.length > 0);
  assert.ok(groups.SOURCE_UNAVAILABLE.length > 0);
});

test("formatEvidenceMatrixTable has header and 62 data rows", () => {
  const lines = formatEvidenceMatrixTable();
  assert.ok(lines[0]?.includes("automationLevel"));
  assert.equal(lines.length, 64);
});

test("formatFullEvidenceMatrixMarkdown includes key sections", () => {
  const md = formatFullEvidenceMatrixMarkdown();
  assert.match(md, /Audit Rule Evidence Matrix/);
  assert.match(md, /EvidenceResult/);
  assert.match(md, /Review \/ QA status aliases/);
  assert.match(md, /ПВ указано в Scrum/);
  assert.match(md, /STRICT/);
});

function baseResult(cards: AuditResult["cards"]): AuditResult {
  return {
    meta: {
      projectName: "Test",
      boardUrl: "https://apptask.ru/c/7/board/445",
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

const emptyTask = {
  id: "1",
  url: "https://apptask.ru/c/7/board/445/1",
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
  boardId: "445",
};

test("deadline evidence: zero candidates when no urgent deadlines", () => {
  const result = baseResult([
    {
      task: { ...emptyTask, dueDate: "01.01.2027" },
      results: [
        { ruleId: "deadline_less_than_one_day", status: "PASS", reason: "OK" },
      ],
    },
    {
      task: { ...emptyTask, id: "2", status: "Завершено" },
      results: [
        {
          ruleId: "deadline_less_than_one_day",
          status: "PASS",
          reason: "Задача завершена",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("deadline_less_than_one_day", result);
  assert.equal(ev.candidateCount, 0);
  assert.equal(ev.status, "OK");
  assert.equal(ev.summaryLabel, "Кандидатов для проверки нет");
  assert.doesNotMatch(ev.summaryLabel ?? "", /64/);
});

test("deadline evidence: counts only urgent candidates", () => {
  const result = baseResult([
    {
      task: { ...emptyTask, dueDate: "10.06.2026" },
      results: [
        {
          ruleId: "deadline_less_than_one_day",
          status: "WARN",
          reason: "До дедлайна меньше 1 дня",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("deadline_less_than_one_day", result);
  assert.equal(ev.candidateCount, 1);
  assert.equal(ev.violationCount, 1);
  assert.equal(ev.violationEvidence.length, 1);
});

test("scrum PV evidence: PARTIAL with notChecked list", () => {
  const result = baseResult([
    {
      task: {
        ...emptyTask,
        id: "63",
        title: "Конкурентный анализ проекта",
      },
      results: [
        {
          ruleId: "scrum_planned_hours_present",
          status: "SKIP",
          reason: "Нет строки сметы — ПВ не проверялось",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("scrum_planned_hours_present", result);
  assert.equal(ev.status, "PARTIAL");
  assert.equal(ev.notCheckedCount, 1);
  assert.equal(ev.notCheckedEvidence[0]?.objectLabel, "№63 — Конкурентный анализ проекта");
});

test("review stale evidence: zero review tasks shows debug", () => {
  const result = baseResult([
    {
      task: { ...emptyTask, status: "В процессе" },
      results: [
        {
          ruleId: "review_stale",
          status: "NOT_APPLICABLE",
          reason: "Не на проверке",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("review_stale", result);
  assert.equal(ev.candidateCount, 0);
  assert.equal(ev.summaryLabel, "Текущих задач в QA/review: 0");
  assert.ok(ev.debug?.reviewStatusAliases);
  assert.ok(ev.debug?.statusDistribution);
});

test("scrum decomposition evidence: zero candidates when no PV > 20h", () => {
  const result = baseResult([
    {
      task: emptyTask,
      results: [
        { ruleId: "scrum_decomposition_over_20h", status: "PASS", reason: "OK" },
      ],
    },
  ]);
  const ev = buildEvidenceResult("scrum_decomposition_over_20h", result);
  assert.equal(ev.candidateCount, 0);
  assert.match(ev.summaryLabel ?? "", /0 задач с ПВ >20 ч/);
});

test("open questions evidence: PARTIAL when question marks but no marker candidates", () => {
  const result = baseResult([
    {
      task: {
        ...emptyTask,
        comments: [
          {
            id: "c1",
            createTime: "2026-06-01T10:00:00Z",
            creatorName: "Alice",
            text: "Какой API?",
          },
        ],
      },
      results: [
        { ruleId: "open_questions_closed", status: "PASS", reason: "OK" },
      ],
    },
  ]);
  const ev = buildEvidenceResult("open_questions_closed", result);
  assert.equal(ev.status, "PARTIAL");
  assert.ok(ev.debug?.commentsWithQuestionMark);
});

test("open questions evidence: includes comment scan debug", () => {
  const result = baseResult([
    {
      task: {
        ...emptyTask,
        comments: [
          {
            id: "c1",
            createTime: "2026-06-01T10:00:00Z",
            creatorName: "Alice",
            text: "Какой API использовать?",
          },
        ],
      },
      results: [
        {
          ruleId: "open_questions_closed",
          status: "WARN",
          reason: "Вопрос без ответа",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("open_questions_closed", result);
  assert.ok(ev.debug?.commentsTotal);
  assert.equal(ev.automationLevel, "PARTIAL");
});

test("blocked assignee evidence: OK when assignees checked", () => {
  const result = baseResult([
    {
      task: emptyTask,
      results: [
        {
          ruleId: "blocked_assignee_not_allowed",
          status: "PASS",
          reason: "OK",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("blocked_assignee_not_allowed", result);
  assert.equal(ev.automationLevel, "STRICT");
  assert.equal(ev.status, "OK");
});

test("blocked assignee evidence: SKIP when users not loaded", () => {
  const result = baseResult([
    {
      task: emptyTask,
      results: [
        {
          ruleId: "blocked_assignee_not_allowed",
          status: "SKIP",
          reason: "Список пользователей AppTask недоступен",
        },
      ],
    },
  ]);
  const ev = buildEvidenceResult("blocked_assignee_not_allowed", result);
  assert.equal(ev.status, "SKIP");
});

test("buildExampleEvidenceResults returns 5 examples", () => {
  const result = baseResult([
    {
      task: emptyTask,
      results: [
        { ruleId: "deadline_less_than_one_day", status: "PASS", reason: "OK" },
        {
          ruleId: "scrum_planned_hours_present",
          status: "PASS",
          reason: "OK",
        },
        {
          ruleId: "review_stale",
          status: "NOT_APPLICABLE",
          reason: "Не на проверке",
        },
        {
          ruleId: "open_questions_closed",
          status: "PASS",
          reason: "OK",
        },
        {
          ruleId: "blocked_assignee_not_allowed",
          status: "PASS",
          reason: "OK",
        },
      ],
    },
  ]);
  const examples = buildExampleEvidenceResults(result);
  assert.equal(examples.length, EXAMPLE_EVIDENCE_RULE_IDS.length);
  for (const id of EXAMPLE_EVIDENCE_RULE_IDS) {
    assert.ok(examples.some((e) => e.ruleId === id));
  }
});
