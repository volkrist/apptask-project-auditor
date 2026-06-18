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

test("contract report uses evidence tables for violations", () => {
  const cards = [
    {
      task: {
        id: "65",
        url: "https://apptask.ru/c/7/board/783/65",
        title: '7.2.3 Bконка бустера "Фора” (UI/UX)',
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
          ruleId: "scrum_title_matches_estimate",
          status: "WARN" as const,
          reason:
            'AppTask: «7.2.3 Bконка бустера "Фора” (UI/UX)» ≠ смета: «7.2.3 Иконка бустера "Фора” (UI/UX)»',
        },
      ],
    },
  ];

  const md = buildContractAuditMarkdown({
    ...baseResult({ warnCount: 1 }),
    cards,
  });

  assert.match(md, /\| Карточка \| AppTask \| Смета \/ Scrum \| Расхождение \|/);
  assert.match(md, /\[№65/);
  assert.match(md, /Bконка/);
  assert.match(md, /Иконка/);
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

test("contract report includes check registry with all contract items", () => {
  const md = buildContractAuditMarkdown(baseResult());
  assert.match(md, /## Реестр выполненных проверок/);
  assert.match(md, /\| № \| Проверка \| Область \| Проверено \| Кандидатов \| Нарушения \| Итог \|/);
  assert.match(md, /CHECKED:/);
  assert.match(md, /\| 1 \| До дедлайна меньше 1 дня/);
  assert.match(md, /\| 45 \| Названия задач и время готовы к актам/);
  assert.doesNotMatch(md, /Статус выполнения: NOT_APPLICABLE/);
});
