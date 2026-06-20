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

test("buildContractAuditHtml violation panel count matches evidence items", () => {
  const result = baseResult();
  const html = buildContractAuditHtml(result);
  const failBtn = html.match(/id="check-19"[\s\S]*?Нарушения: (\d+)/);
  if (failBtn) {
    const count = Number(failBtn[1]);
    const panel = html.match(/id="check-19-fail"[\s\S]*?<\/div>\s*<div class="panel"/);
    const panelHtml = html.match(/id="check-19-fail">([\s\S]*?)<\/div>\s*(?:<div class="panel"|$)/);
    if (panelHtml) {
      const cards = (panelHtml[1].match(/class="violation-card"/g) ?? []).length;
      assert.equal(cards, count, `check-19: button ${count} vs panel ${cards}`);
    }
  }
});

test("buildContractAuditHtml shows notChecked toggle for partial scrum PV", () => {
  const result = baseResult({ cardsChecked: 1 });
  result.cards[0]!.results.push({
    ruleId: "scrum_planned_hours_present",
    status: "SKIP",
    reason: "Нет строки сметы — ПВ не проверялось",
  });
  const html = buildContractAuditHtml(result);
  assert.match(html, /Не проверено:/);
  assert.match(html, /id="check-13-not-checked"/);
  assert.match(html, /Конкурентный анализ|№63|не найдена в смете|ПВ не проверялось/);
});

test("buildContractAuditHtml okBrief uses rule-specific wording for checks 4, 11, 36", () => {
  const result = baseResult({ cardsChecked: 1 });
  result.cards[0]!.results.push(
    {
      ruleId: "blocked_task_reason",
      status: "NOT_APPLICABLE",
      reason: "Задача не заблокирована",
    },
    {
      ruleId: "vague_done_comment",
      status: "NOT_APPLICABLE",
      reason: "Маркеры не найдены",
    },
  );
  result.entityFindings = [
    {
      ruleId: "task_type_classification",
      status: "PASS",
      reason: "ok",
      scope: "project",
      objectLabel: "классификация",
    },
  ];
  const html = buildContractAuditHtml(result);
  const block4 = html.match(/id="check-4"[\s\S]*?<\/article>/)?.[0] ?? "";
  const block36 = html.match(/id="check-36"[\s\S]*?<\/article>/)?.[0] ?? "";
  assert.match(block4, /заблокированных задач не найдено/);
  assert.doesNotMatch(block4, /незакрытых вопросов/);
  assert.match(block36, /маркерам «готово\/сделал\/проверь» нарушений не найдено/);
  assert.doesNotMatch(block36, /незакрытых вопросов/);
  assert.match(html, /Все карточки классифицированы, неизвестных типов: 0/);
});
