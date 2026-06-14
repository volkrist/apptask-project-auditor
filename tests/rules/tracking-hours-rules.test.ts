import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { loadScrumEstimateConfig } from "../../src/scrum/scrum-estimate-config.js";
import type { ScrumAuditContext, ScrumEstimateRow } from "../../src/scrum/scrum-estimate-config.js";
import type { TrackingAuditContext } from "../../src/tracking/load-tracking-context.js";
import {
  aggregateTrackingByTask,
  msToHours,
  type TrackingSummaryRow,
} from "../../src/tracking/tracking-hours-reader.js";
import { loadTrackingHoursConfig } from "../../src/tracking/tracking-hours-config.js";
import {
  ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
  actualHoursExceedsEstimateRule,
  doneTaskWithoutTrackingRule,
  DONE_WITHOUT_TRACKING_RULE,
  estimateExceededWithoutCommentRule,
  inProgressWithoutRecentTrackingRule,
  IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
} from "../../src/rules/soft/tracking-hours-rules.js";

const config = loadAuditConfig({ linkCheckEnabled: false });
const scrumConfig = loadScrumEstimateConfig();
const trackingConfig = loadTrackingHoursConfig();

function row(partial: Partial<TrackingSummaryRow> & Pick<TrackingSummaryRow, "board_id" | "user_id" | "date">): TrackingSummaryRow {
  return {
    task_id: partial.task_id ?? 1,
    user_name: partial.user_name ?? null,
    total_time: partial.total_time ?? 0,
    append_total_time: partial.append_total_time ?? 0,
    removed: partial.removed ?? 0,
    ...partial,
  };
}

function trackingCtx(
  rows: TrackingSummaryRow[],
  boardIds = [783],
  estimateBoardIds: number[] = [783],
): TrackingAuditContext {
  const aggregated = aggregateTrackingByTask(rows, boardIds);
  const byTaskKey: TrackingAuditContext["byTaskKey"] = {};
  for (const t of aggregated) {
    byTaskKey[`${t.boardId}:${t.taskId}`] = t;
  }
  return {
    config: {
      ...trackingConfig,
      estimateBoardIds,
    },
    loaded: true,
    byTaskKey,
    rowCount: rows.length,
  };
}

function estimateRow(partial: Partial<ScrumEstimateRow> & Pick<ScrumEstimateRow, "title">): ScrumEstimateRow {
  const title = partial.title;
  return {
    sourceSheet: partial.sourceSheet ?? "S1",
    rowIndex: partial.rowIndex ?? 2,
    taskTitle: partial.taskTitle ?? title,
    subtaskTitle: partial.subtaskTitle ?? null,
    fullTitle: partial.fullTitle ?? title,
    estimateHours: partial.estimateHours ?? partial.plannedHours ?? null,
    code: partial.code ?? "",
    title,
    plannedHours: partial.plannedHours ?? partial.estimateHours ?? null,
    estimateHoursRisk: null,
    subTask: partial.subTask ?? null,
    comment: partial.comment ?? null,
    raw: partial.raw ?? {},
  };
}

function scrumCtx(rows: ScrumEstimateRow[]): ScrumAuditContext {
  return { config: scrumConfig, rows, loaded: true, sources: [] };
}

test("actualHours uses total_time only; append shown separately", () => {
  const rows = [
    row({
      board_id: 783,
      task_id: 10,
      user_id: 1,
      total_time: 3_600_000,
      append_total_time: 1_800_000,
      date: "2026-06-10T00:00:00.000Z",
    }),
  ];
  const agg = aggregateTrackingByTask(rows, [783])[0]!;
  assert.equal(agg.actualHours, 1);
  assert.equal(agg.manualAppendHours, 0.5);
  assert.equal(agg.totalHours, 1);
});

test("append_total_time does not affect done_task_without_tracking when actual > 0", async () => {
  const task = {
    ...emptyRawTask(),
    id: "10",
    boardId: "783",
    status: "Готово",
  };
  const rows = [
    row({
      board_id: 783,
      task_id: 10,
      user_id: 1,
      total_time: 3_600_000,
      append_total_time: 9_000_000,
      date: "2026-06-10T00:00:00.000Z",
    }),
  ];
  const r = await doneTaskWithoutTrackingRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx(rows),
  });
  assert.equal(r.status, "PASS");
});

test("done + 0 actual hours → WARN", async () => {
  const task = {
    ...emptyRawTask(),
    id: "11",
    boardId: "783",
    status: "Завершено",
  };
  const r = await doneTaskWithoutTrackingRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx([]),
  });
  assert.equal(r.status, "WARN");
  assert.equal(r.ruleId, DONE_WITHOUT_TRACKING_RULE);
});

test("in progress without recent tracking → WARN", async () => {
  const task = {
    ...emptyRawTask(),
    id: "12",
    boardId: "783",
    status: "В процессе",
  };
  const oldDate = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const rows = [
    row({
      board_id: 783,
      task_id: 12,
      user_id: 1,
      total_time: 1_000_000,
      date: oldDate,
    }),
  ];
  const r = await inProgressWithoutRecentTrackingRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx(rows),
  });
  assert.equal(r.status, "WARN");
  assert.equal(r.ruleId, IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE);
});

test("actual > estimate + 20% → WARN on board 783", async () => {
  const task = {
    ...emptyRawTask(),
    id: "1",
    title: "3.2.1 UI: HUD",
    boardId: "783",
    status: "В процессе",
  };
  const rows = [
    row({
      board_id: 783,
      task_id: 1,
      user_id: 1,
      total_time: 10 * 3_600_000,
      date: "2026-06-10T00:00:00.000Z",
    }),
  ];
  const r = await actualHoursExceedsEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx(rows, [783], [783]),
    scrum: scrumCtx([
      estimateRow({ title: "3.2.1 UI: HUD", plannedHours: 8 }),
    ]),
  });
  assert.equal(r.status, "WARN");
  assert.equal(r.ruleId, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
});

test("actual below estimate + 20% → PASS", async () => {
  const task = {
    ...emptyRawTask(),
    id: "1",
    title: "3.2.1 UI: HUD",
    boardId: "783",
    status: "В процессе",
  };
  const rows = [
    row({
      board_id: 783,
      task_id: 1,
      user_id: 1,
      total_time: 9 * 3_600_000,
      date: "2026-06-10T00:00:00.000Z",
    }),
  ];
  const r = await actualHoursExceedsEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx(rows, [783], [783]),
    scrum: scrumCtx([
      estimateRow({ title: "3.2.1 UI: HUD", plannedHours: 8 }),
    ]),
  });
  assert.equal(r.status, "PASS");
  assert.equal(msToHours(9 * 3_600_000), 9);
});

test("board 445 SKIP actual_hours_exceeds_estimate", async () => {
  const task = {
    ...emptyRawTask(),
    title: "HR task",
    boardId: "445",
    status: "В процессе",
  };
  const r = await actualHoursExceedsEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx([], [445], [783]),
    scrum: scrumCtx([
      estimateRow({ title: "HR task", plannedHours: 1 }),
    ]),
  });
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /SKIP/);
});

test("estimate exceeded without explanation comment → WARN", async () => {
  const task = {
    ...emptyRawTask(),
    id: "2",
    title: "4.1 API",
    boardId: "783",
    status: "В процессе",
    comments: [{ text: "сделал", creatorName: "dev" }],
  };
  const rows = [
    row({
      board_id: 783,
      task_id: 2,
      user_id: 1,
      total_time: 30 * 3_600_000,
      date: "2026-06-10T00:00:00.000Z",
    }),
  ];
  const r = await estimateExceededWithoutCommentRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx(rows, [783], [783]),
    scrum: scrumCtx([
      estimateRow({ title: "4.1 API", plannedHours: 10 }),
    ]),
  });
  assert.equal(r.status, "WARN");
});

test("estimate exceeded with explanation marker → PASS", async () => {
  const task = {
    ...emptyRawTask(),
    id: "2",
    title: "4.1 API",
    boardId: "783",
    status: "В процессе",
    comments: [{ text: "перерасход из-за блокера на API", creatorName: "dev" }],
  };
  const rows = [
    row({
      board_id: 783,
      task_id: 2,
      user_id: 1,
      total_time: 30 * 3_600_000,
      date: "2026-06-10T00:00:00.000Z",
    }),
  ];
  const r = await estimateExceededWithoutCommentRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: trackingCtx(rows, [783], [783]),
    scrum: scrumCtx([
      estimateRow({ title: "4.1 API", plannedHours: 10 }),
    ]),
  });
  assert.equal(r.status, "PASS");
});
