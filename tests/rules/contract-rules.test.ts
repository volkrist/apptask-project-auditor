import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import {
  actReadyNamingRule,
  boardFolderLinkRule,
  boardNameTemplateRule,
  trackingDailyAnomalyRule,
  uiHasMockupLinkRule,
} from "../../src/rules/contract/contract-rules.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("ui_has_mockup_link returns NOT_APPLICABLE for non-ui task", async () => {
  const task = { ...emptyRawTask(), title: "Backend API", boardId: "783" };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
});

test("board_name_template uses board metadata", async () => {
  const task = { ...emptyRawTask(), boardId: "783" };
  const r = await boardNameTemplateRule.evaluate(task, {
    config,
    allTasks: [task],
    boardMetadata: {
      "783": {
        boardId: 783,
        name: "TURBO WEAVE (Аутстафф) - Максим Челпанов",
        description: null,
        comment: null,
        discordLink: null,
      },
    },
  });
  assert.notEqual(r.status, "SKIP");
});

test("board_folder_link warns on empty description", async () => {
  const task = { ...emptyRawTask(), boardId: "783" };
  const r = await boardFolderLinkRule.evaluate(task, {
    config,
    allTasks: [task],
    boardMetadata: {
      "783": {
        boardId: 783,
        name: "Board",
        description: null,
        comment: null,
        discordLink: null,
      },
    },
  });
  assert.equal(r.status, "WARN");
});

test("tracking_daily_anomaly warns on high daily hours", async () => {
  const task = { ...emptyRawTask(), boardId: "783", id: "1" };
  const r = await trackingDailyAnomalyRule.evaluate(task, {
    config,
    allTasks: [task],
    tracking: {
      loaded: true,
      config: {} as never,
      byTaskKey: {},
      dailyByTaskKey: {
        "783:1": [
          { userId: 1, userName: "Dev", date: "2026-06-18", hours: 12 },
        ],
      },
      rowCount: 1,
    },
  });
  assert.equal(r.status, "WARN");
});

test("act_ready_naming passes for open tasks", async () => {
  const task = { ...emptyRawTask(), status: "В работе", title: "x" };
  const r = await actReadyNamingRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});

test("act_ready_naming warns on short done title", async () => {
  const task = { ...emptyRawTask(), status: "Завершено", title: "фикс" };
  const r = await actReadyNamingRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "WARN");
});
