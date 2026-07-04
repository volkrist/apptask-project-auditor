import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import type { ScrumAuditContext } from "../../src/scrum/scrum-estimate-config.js";
import {
  estimatePresentRule,
  taskHasEstimatePresent,
} from "../../src/rules/hard/estimate-present.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("taskHasEstimatePresent: только plannedTime в карточке — false", () => {
  const task = { ...emptyRawTask(), plannedTime: "8 ч" };
  assert.equal(taskHasEstimatePresent(task, config), false);
});

test("taskHasEstimatePresent: ссылка на Google Sheets в описании", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText:
      "ТЗ https://docs.google.com/document/d/abc Cмета https://docs.google.com/spreadsheets/d/xyz/edit",
  };
  assert.equal(taskHasEstimatePresent(task, config), true);
});

test("taskHasEstimatePresent: 00:00 не считается ПВ", () => {
  const task = { ...emptyRawTask(), plannedTime: "00:00" };
  assert.equal(taskHasEstimatePresent(task, config), false);
});

test("taskHasEstimatePresent: ПВ в Google-смете", () => {
  const task = { ...emptyRawTask(), id: "200", title: "7.2.1 HUD" };
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
  assert.equal(taskHasEstimatePresent(task, config, { scrum }), true);
});

test("estimatePresentRule: TurboWeave #100 — только ПВ в карточке → FAIL", () => {
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
  const r = estimatePresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /не засчитывается/i);
});

test("estimatePresentRule: только ссылка на смету → PASS", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText: "Смета https://docs.google.com/spreadsheets/d/1/edit",
  };
  const r = estimatePresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});

test("estimatePresentRule: ничего нет → FAIL", () => {
  const task = { ...emptyRawTask(), descriptionText: "Просто текст без оценки" };
  const r = estimatePresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
});
