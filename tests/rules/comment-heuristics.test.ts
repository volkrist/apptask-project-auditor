import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasMockupApprovalMarker,
  hasVerificationSuccessMarker,
  isOpenQuestionComment,
  isQaCompletionReport,
  isTesterFeedbackComment,
} from "../../src/rules/soft/comment-heuristics.js";
import { findOpenQuestionWithoutReply } from "../../src/rules/soft/open-questions-closed.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { isUiRelatedTask } from "../../src/rules/task-ui.js";
import { classifyTaskType } from "../../src/tasks/task-type-classification.js";

test("hasMockupApprovalMarker detects customer approval phrases", () => {
  assert.equal(
    hasMockupApprovalMarker("С заказчиком согласовано, задачу закрываю"),
    true,
  );
  assert.equal(hasMockupApprovalMarker("Макет согласован с PM"), true);
  assert.equal(hasMockupApprovalMarker("Сверстать по Figma"), false);
});

test("isQaCompletionReport excludes QA result from open questions", () => {
  const text =
    '🧪 Тестирование завершено\nБлокеры: отсутствуют\n✅ Всё ок';
  assert.equal(isQaCompletionReport(text), true);
  assert.equal(isOpenQuestionComment(text), false);
});

test("isOpenQuestionComment detects real questions", () => {
  assert.equal(isOpenQuestionComment("Нужно уточнить размеры?"), true);
  assert.equal(isOpenQuestionComment("Есть вопрос по макету"), true);
});

test("isTesterFeedbackComment detects QA issues and rework", () => {
  assert.equal(
    isTesterFeedbackComment("🧪 Тестирование завершено. Критические замечания: кнопка не работает"),
    true,
  );
  assert.equal(isTesterFeedbackComment("Верну на доработку — UI не соответствует макету"), true);
  assert.equal(
    isTesterFeedbackComment("🧪 Тестирование завершено. Блокеры: отсутствуют"),
    false,
  );
});

test("hasVerificationSuccessMarker accepts QA completion", () => {
  assert.equal(
    hasVerificationSuccessMarker("🧪 Тестирование завершено. Блокеры: отсутствуют"),
    true,
  );
  assert.equal(hasVerificationSuccessMarker("проверено"), true);
});

test("hasVerificationSuccessMarker accepts PM task closure comments", () => {
  assert.equal(
    hasVerificationSuccessMarker("Задачу закрываю. Проект инициализирован"),
    true,
  );
  assert.equal(
    hasVerificationSuccessMarker("Заказчик согласовал. Задачу закрываю"),
    true,
  );
  assert.equal(
    hasVerificationSuccessMarker("С заказчиком согласовано, задачу закрываю"),
    true,
  );
  assert.equal(hasVerificationSuccessMarker("Сделал правки по UI"), false);
});

test("findOpenQuestionWithoutReply ignores QA report", () => {
  const task = {
    ...emptyRawTask(),
    comments: [
      {
        text: '🧪 Тестирование завершено\nБлокеры: отсутствуют\n✅',
        creatorName: "QA",
        createTime: "2026-01-01T10:00:00Z",
      },
    ],
  };
  assert.equal(findOpenQuestionWithoutReply(task), null);
});

test("isUiRelatedTask matches (UI/UX) suffix", () => {
  const task = {
    ...emptyRawTask(),
    title: '7.2.3 Иконка бустера "Фора" (UI/UX)',
  };
  assert.equal(isUiRelatedTask(task), true);
  assert.equal(classifyTaskType(task), "ui");
});

test("findOpenQuestionWithoutReply passes when same author replies in thread", () => {
  const task = {
    ...emptyRawTask(),
    comments: [
      {
        id: 1,
        text: "Как сварить пельмени?",
        creatorName: "Иван",
        createTime: "2026-06-01T10:00:00Z",
        parentId: null,
      },
      {
        id: 2,
        text: "Берём кастрюлю и варим",
        creatorName: "Иван",
        createTime: "2026-06-02T10:00:00Z",
        parentId: 1,
      },
    ],
  };
  assert.equal(findOpenQuestionWithoutReply(task), null);
});

test("URL query string does not trigger open question", () => {
  const text =
    "См. макет https://figma.com/file/abc?node-id=1 тестирование завершено блокеры: отсутствуют";
  assert.equal(isOpenQuestionComment(text), false);
});
