import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
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

test("estimateLinkPresentRule: пустая карточка → FAIL", () => {
  const r = estimateLinkPresentRule.evaluate(emptyRawTask(), {
    config,
    allTasks: [],
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /ТЗ без сметы/i);
});
