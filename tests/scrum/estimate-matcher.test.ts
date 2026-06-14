import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import {
  coreTitleForMatch,
  matchTaskToEstimate,
  normalizeMatchText,
  parseTaskCodeAndTitle,
} from "../../src/scrum/estimate-matcher.js";
import type { ScrumEstimateRow } from "../../src/scrum/scrum-estimate-config.js";

function estimateRow(partial: Partial<ScrumEstimateRow> & Pick<ScrumEstimateRow, "title">): ScrumEstimateRow {
  const title = partial.title;
  return {
    sourceSheet: partial.sourceSheet ?? "test",
    rowIndex: partial.rowIndex ?? 2,
    taskTitle: partial.taskTitle ?? title,
    subtaskTitle: partial.subtaskTitle ?? partial.subTask ?? null,
    fullTitle: partial.fullTitle ?? title,
    estimateHours: partial.estimateHours ?? partial.plannedHours ?? null,
    code: partial.code ?? "",
    title,
    plannedHours: partial.plannedHours ?? partial.estimateHours ?? null,
    estimateHoursRisk: partial.estimateHoursRisk ?? null,
    subTask: partial.subTask ?? partial.subtaskTitle ?? null,
    comment: partial.comment ?? null,
    raw: partial.raw ?? {},
  };
}

const rows: ScrumEstimateRow[] = [
  estimateRow({
    code: "3.2.1",
    title: "3.2.1 UI: HUD",
    plannedHours: 8,
    estimateHours: 8,
  }),
  estimateRow({
    code: "4.1",
    title: "4.1 Backend API",
    plannedHours: 25,
    estimateHours: 25,
  }),
  estimateRow({
    code: "5.0",
    title: "5.0 Long task",
    plannedHours: 8,
    estimateHours: 8,
    subTask: "5.0.1 Sub",
  }),
];

function task(title: string): RawTask {
  return { ...emptyRawTask(), title, status: "В процессе" };
}

test("parseTaskCodeAndTitle extracts code", () => {
  assert.deepEqual(parseTaskCodeAndTitle("3.2.1 UI: HUD"), {
    code: "3.2.1",
    titlePart: "UI: HUD",
  });
});

test("coreTitleForMatch strips code prefix", () => {
  assert.equal(coreTitleForMatch("3.2.1 UI: HUD"), "ui: hud");
});

test("normalizeMatchText maps ё to е", () => {
  assert.equal(normalizeMatchText("  Ёлка   Ёж  "), "елка еж");
});

test("matchTaskToEstimate exact title", () => {
  const m = matchTaskToEstimate(task("3.2.1 UI: HUD"), rows);
  assert.equal(m.kind, "ok");
});

test("matchTaskToEstimate title mismatch", () => {
  const m = matchTaskToEstimate(task("3.2.1 UI: Menu"), rows);
  assert.equal(m.kind, "title_mismatch");
});

test("matchTaskToEstimate not found", () => {
  const m = matchTaskToEstimate(task("9.9 Unknown"), rows);
  assert.equal(m.kind, "not_found");
});

test("normalizeMatchText collapses spaces and nbsp", () => {
  assert.equal(normalizeMatchText("  Hello   World  "), "hello world");
});

test("match by core title without code in AppTask", () => {
  const m = matchTaskToEstimate(task("UI: HUD"), rows);
  assert.equal(m.kind, "ok");
});
