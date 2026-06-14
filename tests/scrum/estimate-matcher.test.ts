import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawTask } from "../../src/adapters/apptask/types.js";
import {
  matchTaskToEstimate,
  normalizeMatchText,
  parseTaskCodeAndTitle,
} from "../../src/scrum/estimate-matcher.js";
import type { ScrumEstimateRow } from "../../src/scrum/scrum-estimate-config.js";

const rows: ScrumEstimateRow[] = [
  {
    code: "3.2.1",
    title: "3.2.1 UI: HUD",
    plannedHours: 8,
    estimateHours: 10,
    subTask: null,
    comment: null,
    raw: {},
  },
  {
    code: "4.1",
    title: "4.1 Backend API",
    plannedHours: 25,
    estimateHours: 30,
    subTask: null,
    comment: null,
    raw: {},
  },
];

function task(title: string): RawTask {
  return {
    id: "1",
    url: null,
    title,
    descriptionText: null,
    createdAt: null,
    startDate: null,
    dueDate: null,
    priority: null,
    status: "В процессе",
    tags: [],
    creator: null,
    assignees: [],
    assigneeRefs: [],
    category: null,
    stage: null,
    plannedTime: null,
    actualTime: null,
    links: [],
    attachments: [],
    comments: [],
  };
}

test("parseTaskCodeAndTitle extracts code", () => {
  assert.deepEqual(parseTaskCodeAndTitle("3.2.1 UI: HUD"), {
    code: "3.2.1",
    titlePart: "UI: HUD",
  });
});

test("matchTaskToEstimate exact code and title", () => {
  const m = matchTaskToEstimate(task("3.2.1 UI: HUD"), rows);
  assert.equal(m.kind, "ok");
});

test("matchTaskToEstimate code mismatch title warns", () => {
  const m = matchTaskToEstimate(task("3.2.1 UI: Menu"), rows);
  assert.equal(m.kind, "code_title_mismatch");
});

test("matchTaskToEstimate not found", () => {
  const m = matchTaskToEstimate(task("9.9 Unknown"), rows);
  assert.equal(m.kind, "not_found");
});

test("normalizeMatchText collapses spaces", () => {
  assert.equal(normalizeMatchText("  Hello   World  "), "hello world");
});
