import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { evaluateTask } from "../../src/rules/evaluate.js";
import {
  deadlineLessThanOneDayRule,
  inProgressStaleRule,
  reviewQueueSizeRule,
  reworkWithoutReasonRule,
} from "../../src/rules/soft/status-comment-rules.js";

function task(overrides: Partial<RawTask>): RawTask {
  return { ...emptyRawTask(), ...overrides };
}

const config = loadAuditConfig({ linkCheckEnabled: false });

test("deadline_less_than_one_day warns when due within 24h", async () => {
  const tomorrow = new Date();
  tomorrow.setHours(tomorrow.getHours() + 6);
  const dd = `${String(tomorrow.getDate()).padStart(2, "0")}.${String(tomorrow.getMonth() + 1).padStart(2, "0")}.${tomorrow.getFullYear()}`;
  const t = task({ status: "В работе", dueDate: dd });
  const r = await deadlineLessThanOneDayRule.evaluate(t, {
    config,
    allTasks: [t],
  });
  assert.equal(r.status, "WARN");
});

test("review_queue_over_limit fires on testing task when board overloaded", async () => {
  const t = task({ boardId: "54", status: "На проверке" });
  const ctx = {
    config,
    allTasks: [t],
    boardMetrics: {
      reviewQueueCount: 15,
      reviewQueueMax: 10,
      byBoard: {
        "54": {
          boardId: "54",
          testingQueueCount: 15,
          testingQueueMax: 10,
          sampleTasks: [],
        },
      },
    },
  };
  const r = await reviewQueueSizeRule.evaluate(t, ctx);
  assert.equal(r.status, "WARN");
});

test("in_progress_stale when last activity old", async () => {
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const t = task({
    status: "В работе",
    updatedAt: old,
    comments: [{ text: "start", createTime: old }],
  });
  const r = await inProgressStaleRule.evaluate(t, { config, allTasks: [t] });
  assert.equal(r.status, "WARN");
});

test("rework_without_reason when no reason comment", async () => {
  const reworkData = JSON.stringify({
    PropertyList: [
      { Name: "StateName", OldValue: "На проверке", NewValue: "В работе" },
    ],
  });
  const t = task({
    history: [
      {
        date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        data: reworkData,
      },
    ],
    comments: [{ text: "не готово", createTime: new Date(Date.now() - 3600 * 1000).toISOString() }],
  });
  const r = await reworkWithoutReasonRule.evaluate(t, { config, allTasks: [t] });
  assert.equal(r.status, "WARN");
});

test("status comment rules included in evaluateTask", async () => {
  const t = task({
    status: "Заблокировано",
    comments: [{ text: "blocked" }],
  });
  const results = await evaluateTask(t, config, [t]);
  assert.ok(results.some((r) => r.ruleId === "blocked_task_reason" && r.status !== "PASS"));
});

test("in_progress_stale limit is 48 business hours by default", async () => {
  const prev = process.env.IN_PROGRESS_STALE_BUSINESS_HOURS;
  delete process.env.IN_PROGRESS_STALE_BUSINESS_HOURS;
  const old = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
  const t = task({ status: "В работе", updatedAt: old });
  const r = await inProgressStaleRule.evaluate(t, { config, allTasks: [t] });
  assert.equal(r.status, "WARN");
  assert.match(r.reason, /48/);
  if (prev) process.env.IN_PROGRESS_STALE_BUSINESS_HOURS = prev;
});
