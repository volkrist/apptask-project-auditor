import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import {
  buildBoardSummaries,
  limitTasksMultiBoard,
} from "../../src/config/audit-scope.js";
import type { CardAudit } from "../../src/rules/rule-types.js";

function task(boardId: string, id: string): RawTask {
  return {
    id,
    boardId,
    url: `https://apptask.ru/c/7/board/${boardId}/${id}`,
    title: `Task ${id}`,
  };
}

test("limitTasksMultiBoard distributes maxCards round-robin", () => {
  const tasks = [
    task("783", "1"),
    task("783", "2"),
    task("783", "3"),
    task("445", "4"),
    task("445", "5"),
    task("54", "6"),
    task("54", "7"),
  ];
  const limited = limitTasksMultiBoard(tasks, [783, 445, 54], 5);
  assert.deepEqual(
    limited.map((t) => `${t.boardId}/${t.id}`),
    ["783/1", "445/4", "54/6", "783/2", "445/5"],
  );
});

test("buildBoardSummaries aggregates per board", () => {
  const cards: CardAudit[] = [
    {
      task: task("445", "4"),
      results: [
        { ruleId: "deadline_present", status: "FAIL", reason: "x" },
        { ruleId: "title_present", status: "PASS", reason: "ok" },
      ],
    },
    {
      task: task("54", "6"),
      results: [{ ruleId: "estimate_present", status: "WARN", reason: "y" }],
    },
  ];
  const summaries = buildBoardSummaries(
    cards,
    { "445": 114, "54": 177 },
    "https://apptask.ru/c/7",
  );
  assert.equal(summaries.length, 2);
  const board445 = summaries.find((s) => s.boardId === "445");
  assert.equal(board445?.tasksChecked, 1);
  assert.equal(board445?.tasksAvailable, 114);
  assert.equal(board445?.failCount, 1);
  assert.equal(board445?.boardUrl, "https://apptask.ru/c/7/board/445");
});
