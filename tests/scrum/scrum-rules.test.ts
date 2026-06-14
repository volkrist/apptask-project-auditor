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
import type { ScrumAuditContext, ScrumEstimateRow } from "../../src/scrum/scrum-estimate-config.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";

const config = loadAuditConfig({ linkCheckEnabled: false });
const scrumConfig = loadScrumEstimateConfig();

function estimateRow(partial: Partial<ScrumEstimateRow> & Pick<ScrumEstimateRow, "title">): ScrumEstimateRow {
  const title = partial.title;
  return {
    sourceSheet: partial.sourceSheet ?? "🚦S1 - test",
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

function scrumCtx(rows: ScrumAuditContext["rows"], loaded = true): ScrumAuditContext {
  return { config: scrumConfig, rows, loaded, sources: [] };
}

test("parseScrumEstimateSheet scans header and reads Оценка (ч)", () => {
  const values = [
    ["Памятка"],
    ["", "", ""],
    ["Пункт", "Задача", "Оценка (ч)", "Под Задача"],
    ["3.2.1", "3.2.1 UI: HUD", "8", ""],
    ["4.1", "4.1 Backend API", "", ""],
  ];
  const parsed = parseScrumEstimateSheet(values, { sourceSheet: "🚦S1 - test" });
  assert.equal(parsed.headerRow, 3);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]!.estimateHours, 8);
  assert.equal(parsed.rows[0]!.fullTitle, "3.2.1 UI: HUD");
});

test("parseScrumEstimateSheet reads decomposition hours alias", () => {
  const values = [
    ["Пункт", "Задача", "Под Задача", "Часы (оценка стаса). В Апптаск"],
    ["1.0", "1.0 Auth", "", "12"],
  ];
  const parsed = parseScrumEstimateSheet(values, {
    sourceSheet: "Этап 2. Декомпозиция",
  });
  assert.equal(parsed.rows[0]!.estimateHours, 12);
});

test("scrum rules SKIP when estimate not loaded", async () => {
  const ctx = {
    config,
    allTasks: [],
    scrum: {
      config: scrumConfig,
      rows: [],
      loaded: false,
      sources: [],
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

test("scrum rules SKIP for board without Scrum source", async () => {
  const task = {
    ...emptyRawTask(),
    title: "HR task",
    boardId: "445",
    status: "В процессе",
  };
  const r = await taskInApprovedEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      estimateRow({ code: "1", title: "1.0 Other", plannedHours: 5 }),
    ]),
  });
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /SKIP/);
  assert.match(r.reason, /445/);
});

test("scrum_task_in_estimate WARN when not in estimate", async () => {
  const task = {
    ...emptyRawTask(),
    title: "9.9 Unknown",
    boardId: "783",
    status: "В процессе",
  };
  const r = await taskInApprovedEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      estimateRow({
        code: "1",
        title: "1.0 Other",
        plannedHours: 5,
      }),
    ]),
  });
  assert.equal(r.status, "WARN");
  assert.match(r.reason, /не найдена в утверждённой смете/i);
});

test("scrum_title_matches_estimate WARN on mismatch", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: Menu",
    boardId: "783",
    status: "В процессе",
  };
  const r = await scrumTitleMatchesEstimateRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      estimateRow({
        code: "3.2.1",
        title: "3.2.1 UI: HUD",
        plannedHours: 8,
      }),
    ]),
  });
  assert.equal(r.status, "WARN");
});

test("scrum_planned_hours_present WARN when PV empty", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: HUD",
    boardId: "783",
    status: "В процессе",
  };
  const r = await scrumPlannedHoursInPortalRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      estimateRow({
        code: "3.2.1",
        title: "3.2.1 UI: HUD",
        plannedHours: null,
      }),
    ]),
  });
  assert.equal(r.status, "WARN");
  assert.match(r.reason, /Оценка \(ч\)/);
});

test("scrum_decomposition_over_20h WARN without subtasks", async () => {
  const task = {
    ...emptyRawTask(),
    title: "4.1 Backend API",
    boardId: "783",
    status: "В процессе",
  };
  const r = await scrumDecompositionOver20hRule.evaluate(task, {
    config,
    allTasks: [task],
    scrum: scrumCtx([
      estimateRow({
        code: "4.1",
        title: "4.1 Backend API",
        plannedHours: 25,
      }),
    ]),
  });
  assert.equal(r.status, "WARN");
});
