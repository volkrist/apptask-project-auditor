import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import {
  extractStatusFromChanges,
  findReviewStartedAt,
  findReworkTransitions,
  parseHistoryData,
} from "../../src/rules/history/history-parser.js";

function task(overrides: Partial<RawTask>): RawTask {
  return { ...emptyRawTask(), ...overrides };
}

const statusChangeData = JSON.stringify({
  PropertyList: [
    { Name: "StateName", OldValue: "В работе", NewValue: "На проверке" },
  ],
});

const reworkData = JSON.stringify({
  PropertyList: [
    { Name: "StateName", OldValue: "На проверке", NewValue: "В работе" },
  ],
});

test("parseHistoryData extracts PropertyList", () => {
  const changes = parseHistoryData(statusChangeData);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.name, "StateName");
});

test("extractStatusFromChanges", () => {
  const changes = parseHistoryData(statusChangeData);
  const sc = extractStatusFromChanges(changes);
  assert.deepEqual(sc, { from: "В работе", to: "На проверке" });
});

test("findReviewStartedAt from history", () => {
  const t = task({
    status: "На проверке",
    history: [
      {
        date: "2026-05-01T10:00:00Z",
        data: statusChangeData,
      },
    ],
  });
  const info = findReviewStartedAt(t);
  assert.ok(info);
  assert.equal(info!.confidence, "history");
  assert.equal(info!.at, "2026-05-01T10:00:00Z");
});

test("findReviewStartedAt fallback to updatedAt", () => {
  const t = task({
    status: "QA",
    updatedAt: "2026-05-02T10:00:00Z",
    history: [],
  });
  const info = findReviewStartedAt(t);
  assert.ok(info);
  assert.equal(info!.confidence, "fallback_update_time");
});

test("findReworkTransitions review to work", () => {
  const t = task({
    boardId: "54",
    history: [
      {
        id: 1,
        date: "2026-05-03T12:00:00Z",
        userName: "QA User",
        data: reworkData,
      },
    ],
  });
  const transitions = findReworkTransitions(t);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]!.fromStatus, "На проверке");
  assert.equal(transitions[0]!.toStatus, "В работе");
});

test("findReviewStartedAt resolves numeric StateId", () => {
  const stateIdData = JSON.stringify({
    PropertyList: [{ Name: "StateId", OldValue: 151, NewValue: 152 }],
  });
  const resolve = (boardId: string | null | undefined, stateId: string | number) => {
    const map: Record<string, string> = {
      "54:151": "В работе",
      "54:152": "На проверке",
    };
    return map[`${boardId}:${stateId}`] ?? null;
  };
  const t = task({
    boardId: "54",
    status: "На проверке",
    history: [{ date: "2026-05-01T10:00:00Z", data: stateIdData }],
  });
  const info = findReviewStartedAt(t, resolve);
  assert.ok(info);
  assert.equal(info!.confidence, "history");
});
