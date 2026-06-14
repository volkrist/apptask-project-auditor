import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSelectOnly,
  buildTaskUrl,
  parseBoardIds,
} from "../../src/collectors/db-config.js";

test("parseBoardIds splits comma list and dedupes", () => {
  assert.deepEqual(parseBoardIds("783, 445,783"), [783, 445]);
  assert.deepEqual(parseBoardIds("783,445,54"), [783, 445, 54]);
  assert.deepEqual(parseBoardIds(""), []);
});

test("buildTaskUrl uses BoardTasks.id not offset_id", () => {
  const url = buildTaskUrl("https://apptask.ru/c/7", 783, 12345);
  assert.equal(url, "https://apptask.ru/c/7/board/783/12345");
});

test("assertSelectOnly rejects write operations", () => {
  assert.throws(() => assertSelectOnly("UPDATE dbo.BoardTasks SET name=1"));
  assert.throws(() => assertSelectOnly("DELETE FROM dbo.BoardTasks"));
  assert.doesNotThrow(() =>
    assertSelectOnly("SELECT id FROM dbo.BoardTasks WHERE board_id = @boardId"),
  );
});
