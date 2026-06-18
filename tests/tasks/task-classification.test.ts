import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { CONTRACT_TURBOWEAVE_V1 } from "../../src/config/audit-profiles.js";
import {
  isFlowOrServiceTask,
  partitionTasksForAudit,
} from "../../src/tasks/task-classification.js";

function task(partial: Partial<RawTask>): RawTask {
  return { ...emptyRawTask(), ...partial };
}

test("isFlowOrServiceTask detects management title", () => {
  const t = task({ title: "Менеджмент (PM)" });
  assert.equal(isFlowOrServiceTask(t), true);
});

test("isFlowOrServiceTask detects communications", () => {
  const t = task({ title: "Коммуникации с заказчиком" });
  assert.equal(isFlowOrServiceTask(t), true);
});

test("regular dev task is auditable", () => {
  const t = task({ title: "Сверстать экран оплаты" });
  assert.equal(isFlowOrServiceTask(t), false);
});

test("partitionTasksForAudit splits flow tasks", () => {
  const tasks = [
    task({ id: "1", title: "Менеджмент" }),
    task({ id: "2", title: "API endpoint" }),
  ];
  const { auditable, excludedFlow } = partitionTasksForAudit(tasks, CONTRACT_TURBOWEAVE_V1);
  assert.equal(auditable.length, 1);
  assert.equal(excludedFlow.length, 1);
});
