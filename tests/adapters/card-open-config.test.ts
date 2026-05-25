import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isShortTaskId,
  resolveOpenAttempts,
} from "../../src/adapters/apptask/card-open-config.js";

test("auto uses click-first for short task ids", () => {
  assert.deepEqual(resolveOpenAttempts("auto", "4"), ["click", "direct"]);
  assert.deepEqual(resolveOpenAttempts("auto", "5280"), ["direct", "click"]);
});

test("url-first and click-first strategies", () => {
  assert.deepEqual(resolveOpenAttempts("url-first", "4"), ["direct", "click"]);
  assert.deepEqual(resolveOpenAttempts("click-first", "5280"), [
    "click",
    "direct",
  ]);
});

test("isShortTaskId", () => {
  assert.equal(isShortTaskId("4"), true);
  assert.equal(isShortTaskId("123"), true);
  assert.equal(isShortTaskId("1234"), false);
  assert.equal(isShortTaskId(null), false);
});
