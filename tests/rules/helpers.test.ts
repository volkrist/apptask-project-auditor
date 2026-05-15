import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseRuDate,
  titleSimilarity,
  isValidHttpUrl,
} from "../../src/rules/helpers.js";

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
