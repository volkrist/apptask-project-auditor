import assert from "node:assert/strict";
import { test } from "node:test";

/** Mirrors collect.ts taskId extraction from card id attribute. */
function extractTaskId(rawId: string | null): string | null {
  return rawId && /^\d+$/.test(rawId) ? rawId : null;
}

test("collect: short numeric card ids are kept (e.g. board 445 task 4)", () => {
  assert.equal(extractTaskId("4"), "4");
  assert.equal(extractTaskId("5765"), "5765");
  assert.equal(extractTaskId("abc"), null);
});
