import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import {
  actReadyNamingRule,
  boardFolderLinkRule,
  boardNameTemplateRule,
  massStartWithoutCompletionRule,
  developerActiveTasksLimitRule,
  verifiedSuccessCommentRule,
  testerFeedbackHasProofRule,
  trackingDailyAnomalyRule,
  uiHasMockupLinkRule,
} from "../../src/rules/contract/contract-rules.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("ui_has_mockup_link returns NOT_APPLICABLE for non-ui task", async () => {
  const task = { ...emptyRawTask(), title: "Backend API", boardId: "783" };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
});

test("board_name_template is entity-level on cards", async () => {
  const task = { ...emptyRawTask(), boardId: "783" };
  const r = await boardNameTemplateRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
});

test("tracking_daily_anomaly is entity-level on cards", async () => {
  const task = { ...emptyRawTask(), boardId: "783", id: "1" };
  const r = await trackingDailyAnomalyRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
});

test("act_ready_naming warns on short done title", async () => {
  const task = { ...emptyRawTask(), status: "Завершено", title: "фикс" };
  const r = await actReadyNamingRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "WARN");
});

test("board_folder_link not evaluated per card", async () => {
  const task = { ...emptyRawTask(), boardId: "783" };
  const r = await boardFolderLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
});

test("mass_start warns when assignee has 4+ tasks in progress", async () => {
  const mk = (id: string, assignee: string) => ({
    ...emptyRawTask(),
    id,
    boardId: "783",
    status: "В процессе",
    assignees: [assignee],
  });
  const assignee = "Артём Цапенко";
  const allTasks = ["1", "2", "3", "4"].map((id) => mk(id, assignee));
  const r = await massStartWithoutCompletionRule.evaluate(allTasks[0]!, {
    config,
    allTasks,
  });
  assert.equal(r.status, "WARN");
  assert.match(r.reason, /4 задач в работе/);
});

test("developer_active_tasks_limit warns above 3 in progress", async () => {
  const assignee = "Артём Цапенко";
  const allTasks = ["1", "2", "3", "4"].map((id) => ({
    ...emptyRawTask(),
    id,
    boardId: "783",
    status: "В процессе",
    assignees: [assignee],
  }));
  const r = await developerActiveTasksLimitRule.evaluate(allTasks[0]!, {
    config,
    allTasks,
  });
  assert.equal(r.status, "WARN");
});

test("verified_success_comment passes on PM closure comment", async () => {
  const task = {
    ...emptyRawTask(),
    status: "Завершено",
    comments: [
      {
        text: "Заказчик согласовал. Задачу закрываю",
        creatorName: "Максим Челпанов",
      },
    ],
  };
  const r = await verifiedSuccessCommentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});

test("tester_feedback_has_proof warns without proof in any status", async () => {
  const task = {
    ...emptyRawTask(),
    status: "В процессе",
    comments: [
      {
        text: "Баг: кнопка не работает на мобильной версии",
        creatorName: "QA Tester",
      },
    ],
  };
  const r = await testerFeedbackHasProofRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "WARN");
});

test("tester_feedback_has_proof passes on HTML image in comment", async () => {
  const task = {
    ...emptyRawTask(),
    status: "На проверке",
    comments: [
      {
        text: "Ошибка отступов",
        content:
          '<p>Ошибка отступов</p><img src="https://apptask.ru/uploads/shot.png">',
        creatorName: "QA Tester",
      },
    ],
  };
  const r = await testerFeedbackHasProofRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});
