import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadScrumEstimateConfig } from "../../src/scrum/scrum-estimate-config.js";
import { parseScrumEstimateSheet } from "../../src/scrum/google-sheets-reader.js";
import {
  taskInApprovedEstimateRule,
  scrumTitleMatchesEstimateRule,
  scrumPlannedHoursInPortalRule,
  scrumDecompositionOver20hRule,
} from "../../src/rules/soft/scrum-board-rules.js";
import type { ScrumAuditContext } from "../../src/scrum/scrum-estimate-config.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";

const config = loadAuditConfig({ linkCheckEnabled: false });
const scrumConfig = loadScrumEstimateConfig();

function scrumCtx(rows: ScrumAuditContext["rows"], loaded = true): ScrumAuditContext {
  return { config: scrumConfig, rows, loaded };
}

test("parseScrumEstimateSheet reads Оценка (ч) column", () => {
  const values = [
    ["Пункт", "Задача", "Оценка (ч)", "Под Задача"],
    ["3.2.1", "3.2.1 UI: HUD", "8", ""],
    ["4.1", "4.1 Backend API", "", ""],
  ];
  const rows = parseScrumEstimateSheet(values, {
    taskColumn: "Задача",
    pvColumn: "Оценка (ч)",
    subTaskColumn: "Под Задача",
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.plannedHours, 8);
  assert.equal(rows[1]!.plannedHours, null);
});

test("scrum rules SKIP when estimate not loaded", async () => {
  const ctx = {
    config,
    allTasks: [],
    scrum: {
      config: scrumConfig,
      rows: [],
      loaded: false,
      loadError: "access denied",
    },
  };
  const r = await taskInApprovedEstimateRule.evaluate(
    { ...emptyRawTask(), title: "Test", status: "В процессе" },
    ctx,
  );
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /SKIP/);
});

test("scrum_task_in_estimate FAIL when not in estimate", async () => {
  const task = {
    ...emptyRawTask(),
    title: "9.9 Unknown",
    status: "В процессе",
  };
  const r = await taskInApprovedEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      {
        code: "1",
        title: "1.0 Other",
        plannedHours: 5,
        estimateHours: null,
        subTask: null,
        comment: null,
        raw: {},
      },
    ]),
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /не найдена в утверждённой смете/i);
});

test("scrum_title_matches_estimate WARN on mismatch", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: Menu",
    status: "В процессе",
  };
  const r = await scrumTitleMatchesEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      {
        code: "3.2.1",
        title: "3.2.1 UI: HUD",
        plannedHours: 8,
        estimateHours: null,
        subTask: null,
        comment: null,
        raw: {},
      },
    ]),
  });
  assert.equal(r.status, "WARN");
});

test("scrum_planned_hours_present WARN when PV empty", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: HUD",
    status: "В процессе",
  };
  const r = await scrumPlannedHoursInPortalRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      {
        code: "3.2.1",
        title: "3.2.1 UI: HUD",
        plannedHours: null,
        estimateHours: null,
        subTask: null,
        comment: null,
        raw: {},
      },
    ]),
  });
  assert.equal(r.status, "WARN");
  assert.match(r.reason, /Оценка \(ч\)/);
});

test("scrum_decomposition_over_20h WARN without subtasks", async () => {
  const task = {
    ...emptyRawTask(),
    title: "4.1 Backend API",
    status: "В процессе",
  };
  const r = await scrumDecompositionOver20hRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      {
        code: "4.1",
        title: "4.1 Backend API",
        plannedHours: 25,
        estimateHours: null,
        subTask: null,
        comment: null,
        raw: {},
      },
    ]),
  });
  assert.equal(r.status, "WARN");
});
