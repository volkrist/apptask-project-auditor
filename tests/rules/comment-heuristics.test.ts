import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasVerificationSuccessMarker,
  isOpenQuestionComment,
  isQaCompletionReport,
} from "../../src/rules/soft/comment-heuristics.js";
import { findOpenQuestionWithoutReply } from "../../src/rules/soft/open-questions-closed.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { isUiRelatedTask } from "../../src/rules/task-ui.js";
import { classifyTaskType } from "../../src/tasks/task-type-classification.js";

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

test("hasVerificationSuccessMarker accepts QA completion", () => {
  assert.equal(
    hasVerificationSuccessMarker("🧪 Тестирование завершено. Блокеры: отсутствуют"),
    true,
  );
  assert.equal(hasVerificationSuccessMarker("проверено"), true);
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

test("URL query string does not trigger open question", () => {
  const text =
    "См. макет https://figma.com/file/abc?node-id=1 тестирование завершено блокеры: отсутствуют";
  assert.equal(isOpenQuestionComment(text), false);
});
