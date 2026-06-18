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
