import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import {
  estimatePresentRule,
  taskHasEstimatePresent,
} from "../../src/rules/hard/estimate-present.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("taskHasEstimatePresent: plannedTime в карточке", () => {
  const task = { ...emptyRawTask(), plannedTime: "8 ч" };
  assert.equal(taskHasEstimatePresent(task, config), true);
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
