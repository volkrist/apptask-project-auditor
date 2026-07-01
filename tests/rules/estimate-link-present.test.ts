import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import type { ScrumAuditContext } from "../../src/scrum/scrum-estimate-config.js";
import {
  estimateLinkPresentRule,
  taskHasEstimateLink,
} from "../../src/rules/hard/estimate-link-present.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("taskHasEstimateLink: Google Sheets в описании", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText:
      "Смета https://docs.google.com/spreadsheets/d/abc/edit",
  };
  assert.equal(taskHasEstimateLink(task, config), true);
});

test("taskHasEstimateLink: только ТЗ (Google Doc) — false", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText:
      "Ссылка на ТЗ https://docs.google.com/document/d/abc/edit",
  };
  assert.equal(taskHasEstimateLink(task, config), false);
});

test("taskHasEstimateLink: слово «договор» в тексте", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText: "Договор №12 от 01.01.2026",
  };
  assert.equal(taskHasEstimateLink(task, config), true);
});

test("estimateLinkPresentRule: spreadsheets URL → PASS", () => {
  const task = {
    ...emptyRawTask(),
    links: [
      "https://docs.google.com/spreadsheets/d/1aNFtgJbvGQ5EuQJNoSNkT1RK3KCl046939Ha42qKCFY/edit",
    ],
  };
  const r = estimateLinkPresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});

test("estimateLinkPresentRule: TurboWeave #100 — ПВ без ссылки на смету → FAIL", () => {
  const task = {
    ...emptyRawTask(),
    id: "100",
    boardId: "783",
    title: "Чаты (front)",
    plannedTime: "11 ч",
    links: ["http://nonexistent-domain-name-12345.ru"],
    descriptionText:
      "Просто много символов, чтобы пройти проверку агента. На самом деле здесь ничего полезного не написано.",
  };
  const r = estimateLinkPresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /ПВ.*не заменяет/i);
  assert.match(r.reason, /Google-смете без ссылки/i);
});

test("estimateLinkPresentRule: строка в Google-смете без ссылки в карточке → FAIL", () => {
  const task = {
    ...emptyRawTask(),
    id: "200",
    title: "7.2.1 HUD",
    plannedTime: "8 ч",
  };
  const scrum = {
    loaded: true,
    rows: [
      {
        sourceSheet: "S1",
        rowIndex: 2,
        taskTitle: "7.2.1 HUD",
        subtaskTitle: null,
        fullTitle: "7.2.1 HUD",
        estimateHours: 8,
        code: "7.2.1",
        title: "7.2.1 HUD",
        plannedHours: 8,
        estimateHoursRisk: null,
        subTask: null,
        comment: null,
        raw: {},
      },
    ],
    sources: [],
    config: {} as ScrumAuditContext["config"],
  } satisfies ScrumAuditContext;
  const r = estimateLinkPresentRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum,
  });
  assert.equal(r.status, "FAIL");
});

test("estimateLinkPresentRule: пустая карточка → FAIL", () => {
  const r = estimateLinkPresentRule.evaluate(emptyRawTask(), {
    config,
    allTasks: [],
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /ТЗ без сметы/i);
});
