import assert from "node:assert/strict";
import { test } from "node:test";
import type { Page } from "@playwright/test";
import { emptyRawTask, type RawTask } from "../../src/adapters/apptask/types.js";
import {
  appTaskCommentsToTaskComments,
  htmlCommentContentToText,
  type AppTaskComment,
} from "../../src/comments/app-task-comments.js";
import {
  filterTasksForCommentsLoad,
  loadCommentsAuditConfig,
  shouldLoadCommentsForTask,
} from "../../src/comments/comments-audit-config.js";
import { enrichTasksWithComments } from "../../src/comments/enrich-tasks-comments.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { evaluateTask } from "../../src/rules/evaluate.js";
import {
  commentPlainTextForRules,
  findUnresolvedQuestionInCard,
} from "../../src/rules/helpers.js";

const baseConfig = loadAuditConfig({ linkCheckEnabled: false });
const RULE_UNRESOLVED = "unresolved_question_keywords_in_card";

function task(overrides: Partial<RawTask>): RawTask {
  return { ...emptyRawTask(), ...overrides };
}

function statusOf(
  results: Awaited<ReturnType<typeof evaluateTask>>,
  ruleId: string,
): string | undefined {
  return results.find((r) => r.ruleId === ruleId)?.status;
}

test("COMMENTS_AUDIT_MODE=off: filter returns no tasks", () => {
  const cfg = loadCommentsAuditConfig({ mode: "off" });
  const tasks = [
    task({ id: "1", status: "В процессе" }),
    task({ id: "2", dueDate: null }),
  ];
  assert.equal(cfg.mode, "off");
  assert.deepEqual(filterTasksForCommentsLoad(tasks, cfg.mode), []);
});

test("candidates: only matching tasks selected", () => {
  const inProgress = task({ id: "1", status: "В процессе", dueDate: "01.01.2030" });
  const noDue = task({ id: "2", status: "Завершено", dueDate: null });
  const done = task({
    id: "3",
    status: "Завершено",
    dueDate: "01.01.2030",
  });

  assert.equal(shouldLoadCommentsForTask(inProgress), true);
  assert.equal(shouldLoadCommentsForTask(noDue), true);
  assert.equal(shouldLoadCommentsForTask(done), false);

  const selected = filterTasksForCommentsLoad(
    [inProgress, noDue, done],
    "candidates",
  );
  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((t) => t.id),
    ["1", "2"],
  );
});

test("all: every task with id is selected", () => {
  const tasks = [
    task({ id: "1", status: "Завершено" }),
    task({ id: null }),
    task({ id: "2" }),
  ];
  const selected = filterTasksForCommentsLoad(tasks, "all");
  assert.equal(selected.length, 2);
});

test("htmlCommentContentToText: <br> → plain text", () => {
  const plain = htmlCommentContentToText(
    "Нужно <br>уточнить<br> сроки&nbsp;",
  );
  assert.match(plain, /уточнить/i);
  assert.ok(!plain.includes("<br"));
  assert.ok(!plain.includes("&nbsp;"));
});

test("unresolved_question: keyword in comment.content (HTML)", async () => {
  const html = "Пожалуйста, <br>ждем ответ<br> от клиента";
  const t = task({
    title: "Задача",
    descriptionText: "Цель: релиз.",
    comments: appTaskCommentsToTaskComments([
      {
        id: 1,
        creatorId: 1,
        content: html,
        createTime: null,
        parentId: null,
        attachmentList: [],
      } satisfies AppTaskComment,
    ]),
    assignees: ["Иван"],
  });
  assert.match(commentPlainTextForRules(t.comments[0]!), /ждем ответ/i);
  const results = await evaluateTask(t, baseConfig, [t]);
  assert.equal(statusOf(results, RULE_UNRESOLVED), "FAIL");
});

test("enrichTasksWithComments: API error → comments=[], audit helpers ok", async () => {
  const fakePage = {
    request: {
      post: async () => ({
        ok: () => false,
        status: () => 500,
        json: async () => ({}),
      }),
    },
  } as unknown as Page;

  const t = task({ id: "5765", status: "В процессе" });
  const stats = await enrichTasksWithComments(fakePage, [t], {
    mode: "candidates",
    concurrency: 1,
  });

  assert.equal(stats.checkedComments, 1);
  assert.deepEqual(t.comments, []);
  assert.equal(
    findUnresolvedQuestionInCard(t, baseConfig.unresolvedQuestionKeywords),
    null,
  );
});
