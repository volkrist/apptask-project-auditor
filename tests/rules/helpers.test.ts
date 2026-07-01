import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import {
  extractTaskType,
  isTitleBlacklisted,
  isTitleTooGeneric,
  parseRuDate,
  titleSimilarity,
  isValidHttpUrl,
} from "../../src/rules/helpers.js";
import type { RawTask } from "../../src/adapters/apptask/types.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("parseRuDate разбирает DD.MM.YYYY", () => {
  const date = parseRuDate("15.05.2026");
  assert.ok(date);
  assert.equal(date!.getFullYear(), 2026);
  assert.equal(date!.getMonth(), 4);
  assert.equal(date!.getDate(), 15);
});

test("parseRuDate возвращает null для мусора", () => {
  assert.equal(parseRuDate("2026-05-15"), null);
});

test("titleSimilarity находит похожие заголовки", () => {
  const score = titleSimilarity(
    "Отчёт по найму май",
    "Отчёт по найму за май",
  );
  assert.ok(score >= 0.85);
});

test("isValidHttpUrl", () => {
  assert.equal(isValidHttpUrl("https://example.com"), true);
  assert.equal(isValidHttpUrl("not-a-url"), false);
});

test("isTitleBlacklisted: токен, не подстрока", () => {
  assert.equal(isTitleBlacklisted("работа", config), true);
  assert.equal(isTitleBlacklisted("Работа с регламентами: изменение процессов", config), false);
});

test("isTitleTooGeneric: ловит общие названия из ТЗ", () => {
  assert.equal(isTitleTooGeneric("правки", config), true);
  assert.equal(isTitleTooGeneric("Правки по UI", config), true);
  assert.equal(isTitleTooGeneric("доработки", config), true);
  assert.equal(isTitleTooGeneric("Доработка модуля", config), true);
  assert.equal(isTitleTooGeneric("баги", config), true);
  assert.equal(isTitleTooGeneric("сайт", config), true);
  assert.equal(isTitleTooGeneric("проверить форму", config), true);
  assert.equal(isTitleTooGeneric("Работа с регламентами: изменение процессов", config), false);
  assert.equal(isTitleTooGeneric("7.2.3 Иконка бустера на главной", config), false);
});

test("extractTaskType: категория Найм → найм", () => {
  const task = { category: "Найм", tags: [] } as RawTask;
  assert.equal(extractTaskType(task, config), "найм");
});
