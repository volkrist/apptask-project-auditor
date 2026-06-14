import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateTrackingByTask,
  isTrackingRowIncluded,
  msToHours,
  sumTrackingMs,
  TRACKING_HOURS_BOARD_TASK_JOIN,
  type TrackingSummaryRow,
} from "../../src/tracking/tracking-hours-reader.js";

function row(
  partial: Partial<TrackingSummaryRow> & Pick<TrackingSummaryRow, "board_id" | "user_id" | "date">,
): TrackingSummaryRow {
  return {
    task_id: partial.task_id ?? 1,
    user_name: partial.user_name ?? null,
    total_time: partial.total_time ?? 0,
    append_total_time: partial.append_total_time ?? 0,
    removed: partial.removed ?? 0,
    ...partial,
  };
}

test("sumTrackingMs adds total_time + append_total_time", () => {
  assert.equal(sumTrackingMs(1_000_000, 500_000), 1_500_000);
  assert.equal(sumTrackingMs(null, 200), 200);
  assert.equal(sumTrackingMs(100, undefined), 100);
});

test("msToHours converts milliseconds", () => {
  assert.equal(msToHours(3_600_000), 1);
  assert.equal(msToHours(1_800_000), 0.5);
});

test("aggregateTrackingByTask sums per task and per user", () => {
  const rows: TrackingSummaryRow[] = [
    row({
      board_id: 783,
      task_id: 1,
      user_id: 10,
      user_name: "Alice",
      total_time: 1_000_000,
      append_total_time: 0,
      date: "2026-06-01T00:00:00.000Z",
    }),
    row({
      board_id: 783,
      task_id: 1,
      user_id: 10,
      user_name: "Alice",
      total_time: 2_000_000,
      append_total_time: 500_000,
      date: "2026-06-02T00:00:00.000Z",
    }),
    row({
      board_id: 783,
      task_id: 1,
      user_id: 20,
      user_name: "Bob",
      total_time: 3_600_000,
      append_total_time: 0,
      date: "2026-06-01T00:00:00.000Z",
    }),
  ];

  const result = aggregateTrackingByTask(rows, [783]);
  assert.equal(result.length, 1);
  const task = result[0]!;
  assert.equal(task.actualMs, 6_600_000);
  assert.equal(task.manualAppendMs, 500_000);
  assert.equal(task.actualHours, msToHours(6_600_000));
  assert.equal(task.manualAppendHours, msToHours(500_000));
  assert.equal(task.usersCount, 2);
  const alice = task.perUser.find((u) => u.userId === 10);
  assert.equal(alice?.actualMs, 3_000_000);
});

test("isTrackingRowIncluded rejects null task_id", () => {
  const r = row({ board_id: 783, task_id: null, user_id: 1, date: "2026-06-01" });
  assert.equal(isTrackingRowIncluded(r, [783]), false);
});

test("isTrackingRowIncluded rejects removed=1", () => {
  const r = row({
    board_id: 783,
    task_id: 5,
    user_id: 1,
    date: "2026-06-01",
    removed: 1,
  });
  assert.equal(isTrackingRowIncluded(r, [783]), false);
});

test("aggregateTrackingByTask respects board scope", () => {
  const rows: TrackingSummaryRow[] = [
    row({
      board_id: 783,
      task_id: 1,
      user_id: 1,
      total_time: 1_000,
      date: "2026-06-01",
    }),
    row({
      board_id: 445,
      task_id: 1,
      user_id: 1,
      total_time: 9_999,
      date: "2026-06-01",
    }),
  ];

  assert.deepEqual(
    aggregateTrackingByTask(rows, [783]).map((t) => t.totalMs),
    [1_000],
  );
  assert.deepEqual(
    aggregateTrackingByTask(rows, [445]).map((t) => t.totalMs),
    [9_999],
  );
});

test("TRACKING_HOURS_BOARD_TASK_JOIN uses task_id and board_id", () => {
  assert.match(TRACKING_HOURS_BOARD_TASK_JOIN, /uts\.task_id = bt\.id/);
  assert.match(TRACKING_HOURS_BOARD_TASK_JOIN, /uts\.board_id = bt\.board_id/);
});
