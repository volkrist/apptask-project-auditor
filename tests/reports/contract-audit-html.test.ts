import assert from "node:assert/strict";
import { test } from "node:test";
import { getFullCheckRegistry } from "../../src/config/contract-check-registry.js";
import { buildContractAuditHtml } from "../../src/reports/build-html-report.js";
import type { AuditResult } from "../../src/rules/rule-types.js";

function registryNum(ruleId: string): number {
  const entry = getFullCheckRegistry().find((e) => e.ruleIds[0] === ruleId);
  if (!entry) throw new Error(`registry entry not found: ${ruleId}`);
  return entry.num;
}

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
  const uiNum = registryNum("ui_has_mockup_link");
  const failBtn = html.match(new RegExp(`id="check-${uiNum}"[\\s\\S]*?Нарушения: (\\d+)`));
  if (failBtn) {
    const count = Number(failBtn[1]);
    const panelHtml = html.match(
      new RegExp(`id="check-${uiNum}-fail">([\\s\\S]*?)<\\/div>\\s*(?:<div class="panel"|$)`),
    );
    if (panelHtml) {
      const cards = (panelHtml[1].match(/class="violation-card"/g) ?? []).length;
      assert.equal(cards, count, `check-${uiNum}: button ${count} vs panel ${cards}`);
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
  const pvNum = registryNum("scrum_planned_hours_present");
  assert.match(html, /Не проверено:/);
  assert.match(html, new RegExp(`id="check-${pvNum}-not-checked"`));
  assert.match(html, /Конкурентный анализ|№63|не найдена в смете|ПВ не проверялось/);
});

test("buildContractAuditHtml okBrief uses rule-specific wording for blocked and vague done", () => {
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
  const blockedReasonNum = registryNum("blocked_task_reason");
  const vagueDoneNum = registryNum("vague_done_comment");
  const blockBlocked = html.match(new RegExp(`id="check-${blockedReasonNum}"[\\s\\S]*?<\\/article>`))?.[0] ?? "";
  const blockVague = html.match(new RegExp(`id="check-${vagueDoneNum}"[\\s\\S]*?<\\/article>`))?.[0] ?? "";
  assert.match(blockBlocked, /Кандидатов для проверки нет|заблокированных задач не найдено/);
  assert.doesNotMatch(blockBlocked, /незакрытых вопросов/);
  assert.match(blockVague, /маркерам «готово\/сделал\/проверь» нарушений не найдено/);
  assert.doesNotMatch(blockVague, /незакрытых вопросов/);
  assert.match(html, /Все карточки классифицированы, неизвестных типов: 0/);
});

test("buildContractAuditHtml includes mandatory fields section with all checks", () => {
  const html = buildContractAuditHtml(baseResult());
  assert.match(html, /Обязательные поля карточки/);
  assert.match(html, /Успешно:.*Нарушений:/);
  assert.match(html, /понятное название задачи/);
  assert.match(html, /id="check-1"/);
  assert.match(html, /id="check-23"/);
});
