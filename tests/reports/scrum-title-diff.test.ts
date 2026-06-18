import assert from "node:assert/strict";
import { test } from "node:test";
import { formatScrumTitleDiff } from "../../src/reports/evidence-markdown.js";

test("formatScrumTitleDiff shows word-level mismatch", () => {
  assert.equal(
    formatScrumTitleDiff(
      '7.2.3 Bконка бустера "Фора” (UI/UX)',
      '7.2.3 Иконка бустера "Фора” (UI/UX)',
    ),
    "Bконка → Иконка",
  );
  assert.equal(
    formatScrumTitleDiff(
      "6.2.1 Состояния меню (вкладки Гараж и Бустеры) (UI/UX)",
      "6.2.1 Состояние меню (вкладки Гараж и Бустеры) (UI/UX)",
    ),
    "Состояния → Состояние",
  );
  assert.equal(
    formatScrumTitleDiff("8.8 Полишинг", "8.8 Полишинг (front)"),
    "8.8 Полишинг → 8.8 Полишинг (front)",
  );
});
