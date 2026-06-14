import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import {
  businessHoursSince,
  computeLastActivityAt,
  countTestingQueueTasks,
  deadlineUrgency,
  findBlockReasonInTask,
  findVagueDoneComments,
  isBlockedTask,
  isCompletedStatus,
  isHighPriorityOrCriticalBug,
  isInProgressStatus,
  isTestingStatus,
  isVagueDoneCommentText,
} from "../../src/rules/status/status-helpers.js";

function task(overrides: Partial<RawTask>): RawTask {
  return { ...emptyRawTask(), ...overrides };
}

test("done status aliases", () => {
  assert.ok(isCompletedStatus("Завершено"));
  assert.ok(isCompletedStatus("Готово"));
  assert.ok(isCompletedStatus("Done"));
  assert.ok(isCompletedStatus("Closed"));
  assert.ok(isCompletedStatus("Закрыто"));
  assert.ok(!isCompletedStatus("В работе"));
});

test("testing status aliases", () => {
  assert.ok(isTestingStatus("На проверке"));
  assert.ok(isTestingStatus("Проверить тестировщику"));
  assert.ok(isTestingStatus("QA"));
  assert.ok(isTestingStatus("Testing"));
  assert.ok(isTestingStatus("Review"));
  assert.ok(isTestingStatus("Проверка"));
});

test("in progress status aliases", () => {
  assert.ok(isInProgressStatus("В процессе"));
  assert.ok(isInProgressStatus("В работе"));
  assert.ok(isInProgressStatus("In progress"));
  assert.ok(isInProgressStatus("Doing"));
});

test("blocked detection", () => {
  assert.ok(isBlockedTask(task({ status: "Заблокировано" })));
  assert.ok(isBlockedTask(task({ tags: ["blocker"] })));
  assert.ok(isBlockedTask(task({ title: "Blocked by API" })));
  assert.ok(!isBlockedTask(task({ title: "Normal task" })));
});

test("deadline urgency overdue and soon", () => {
  const overdue = task({
    status: "В работе",
    dueDate: "01.01.2020",
  });
  assert.equal(deadlineUrgency(overdue).kind, "overdue");

  const tomorrow = new Date();
  tomorrow.setHours(tomorrow.getHours() + 12);
  const dd = `${String(tomorrow.getDate()).padStart(2, "0")}.${String(tomorrow.getMonth() + 1).padStart(2, "0")}.${tomorrow.getFullYear()}`;
  const soon = task({ status: "В работе", dueDate: dd });
  assert.equal(deadlineUrgency(soon).kind, "soon");

  const done = task({ status: "Готово", dueDate: "01.01.2020" });
  assert.equal(deadlineUrgency(done).kind, "none");
});

test("computeLastActivityAt uses max of update, history, comments", () => {
  const t = task({
    updatedAt: "2026-01-01T10:00:00Z",
    history: [{ date: "2026-02-01T10:00:00Z" }],
    comments: [{ text: "x", createTime: "2026-03-01T10:00:00Z" }],
  });
  assert.equal(computeLastActivityAt(t), "2026-03-01T10:00:00.000Z");
});

test("businessHoursSince counts recent weekday hours", () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
  const dow = twoHoursAgo.getDay();
  if (dow === 0 || dow === 6) return;
  const hours = businessHoursSince(twoHoursAgo.toISOString());
  assert.ok(hours != null && hours >= 1.5 && hours <= 3);
});

test("countTestingQueueTasks", () => {
  const tasks = [
    task({ status: "На проверке" }),
    task({ status: "В работе" }),
    task({ status: "QA" }),
  ];
  assert.equal(countTestingQueueTasks(tasks).length, 2);
});

test("high priority / critical bug markers", () => {
  assert.ok(isHighPriorityOrCriticalBug(task({ priority: "Высокий" })).match);
  assert.ok(isHighPriorityOrCriticalBug(task({ tags: ["critical"] })).match);
  assert.ok(
    isHighPriorityOrCriticalBug(task({ title: "Критичный баг в оплате" })).match,
  );
});

test("vague done comment detection", () => {
  assert.ok(isVagueDoneCommentText("Готово"));
  assert.ok(isVagueDoneCommentText("сделал, проверь"));
  assert.ok(!isVagueDoneCommentText("Готово: PR https://github.com/x/pull/1"));
  const vague = findVagueDoneComments(
    task({ comments: [{ text: "Готово" }, { text: "Подробный отчёт о работе" }] }),
  );
  assert.equal(vague.length, 1);
});

test("blocked reason in comments", () => {
  const ok = task({
    status: "Заблокировано",
    comments: [{ text: "Ждём ответ от заказчика по API доступу" }],
  });
  assert.ok(findBlockReasonInTask(ok));
  const bad = task({
    status: "Заблокировано",
    comments: [{ text: "blocked" }],
  });
  assert.equal(findBlockReasonInTask(bad), null);
});
