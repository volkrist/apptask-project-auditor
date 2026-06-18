import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTaskType, summarizeTaskTypes } from "../../src/tasks/task-type-classification.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { findOpenQuestionWithoutReply } from "../../src/rules/soft/open-questions-closed.js";
import {
  descriptionReflectsWorksheet,
  projectNamesAlign,
} from "../../src/worksheet/worksheet-reader.js";

test("classifyTaskType detects flow and ui", () => {
  const flow = { ...emptyRawTask(), title: "Менеджмент (PM)" };
  const ui = { ...emptyRawTask(), title: "3.2.1 UI: HUD (UI/UX)" };
  const uiSuffix = {
    ...emptyRawTask(),
    title: '7.2.3 Иконка бустера "Фора" (UI/UX)',
  };
  const regular = { ...emptyRawTask(), title: "3.1.1 Движение (front)" };
  assert.equal(classifyTaskType(flow), "flow");
  assert.equal(classifyTaskType(ui), "ui");
  assert.equal(classifyTaskType(uiSuffix), "ui");
  assert.equal(classifyTaskType(regular), "regular");
});

test("summarizeTaskTypes counts buckets", () => {
  const tasks = [
    { ...emptyRawTask(), id: "1", title: "Менеджмент (PM)" },
    { ...emptyRawTask(), id: "2", title: "3.2 UI (front)" },
    { ...emptyRawTask(), id: "3", title: "3.1.1 Движение (front)" },
  ];
  const s = summarizeTaskTypes(tasks);
  assert.equal(s.flow, 1);
  assert.equal(s.ui, 1);
  assert.equal(s.regular, 1);
  assert.equal(s.unknown, 0);
});

test("projectNamesAlign matches turbo weave variants", () => {
  assert.equal(
    projectNamesAlign(
      "TURBO WEAVE (Аутстафф) - Максим Челпанов",
      "TURBO WEAVE",
    ),
    true,
  );
});

test("descriptionReflectsWorksheet finds overlap", () => {
  assert.equal(
    descriptionReflectsWorksheet(
      "Краткое описание: гоночная игра Turbo Weave",
      "гоночная игра Turbo Weave",
    ),
    true,
  );
});

test("findOpenQuestionWithoutReply detects unanswered question", () => {
  const task = {
    ...emptyRawTask(),
    comments: [
      {
        text: "Нужно уточнить размеры?",
        creatorName: "Иван",
        createTime: "2026-01-01T10:00:00Z",
      },
    ],
  };
  assert.ok(findOpenQuestionWithoutReply(task));
});

test("findOpenQuestionWithoutReply passes when another user replied", () => {
  const task = {
    ...emptyRawTask(),
    comments: [
      {
        text: "Нужно уточнить размеры?",
        creatorName: "Иван",
        createTime: "2026-01-01T10:00:00Z",
      },
      {
        text: "Размеры в макете Figma, см. ссылку",
        creatorName: "Петр",
        createTime: "2026-01-01T11:00:00Z",
      },
    ],
  };
  assert.equal(findOpenQuestionWithoutReply(task), null);
});
