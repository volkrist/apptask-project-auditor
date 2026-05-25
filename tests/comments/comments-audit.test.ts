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
import {
  isTaskOnBoard,
  resolveCommentsBoardContext,
} from "../../src/comments/comments-board-context.js";
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

test("candidates + commentsLimit=2: only first two candidates", () => {
  const tasks = [
    task({ id: "1", status: "В процессе" }),
    task({ id: "2", dueDate: null, status: "Завершено" }),
    task({ id: "3", status: "На проверке" }),
  ];
  const selected = filterTasksForCommentsLoad(tasks, {
    mode: "candidates",
    commentsLimit: 2,
  });
  assert.deepEqual(
    selected.map((t) => t.id),
    ["1", "2"],
  );
});

test("all + commentsLimit=2: only first two tasks with id", () => {
  const tasks = [
    task({ id: "1" }),
    task({ id: "2" }),
    task({ id: "3" }),
  ];
  const selected = filterTasksForCommentsLoad(tasks, {
    mode: "all",
    commentsLimit: 2,
  });
  assert.deepEqual(
    selected.map((t) => t.id),
    ["1", "2"],
  );
});

test("commentsLimit does not affect audit task list size", () => {
  const tasks = [
    task({ id: "1", status: "В процессе" }),
    task({ id: "2", status: "В процессе" }),
    task({ id: "3", status: "В процессе" }),
  ];
  const forComments = filterTasksForCommentsLoad(tasks, {
    mode: "all",
    commentsLimit: 1,
  });
  assert.equal(forComments.length, 1);
  assert.equal(tasks.length, 3);
});

test("COMMENTS_AUDIT_LIMIT from env", () => {
  const prev = process.env.COMMENTS_AUDIT_LIMIT;
  process.env.COMMENTS_AUDIT_LIMIT = "5";
  try {
    const cfg = loadCommentsAuditConfig();
    assert.equal(cfg.commentsLimit, 5);
  } finally {
    if (prev === undefined) delete process.env.COMMENTS_AUDIT_LIMIT;
    else process.env.COMMENTS_AUDIT_LIMIT = prev;
  }
});

test("Discord override: commentsLimit in config beats env", () => {
  const prev = process.env.COMMENTS_AUDIT_LIMIT;
  process.env.COMMENTS_AUDIT_LIMIT = "10";
  try {
    const cfg = loadCommentsAuditConfig({ commentsLimit: 2 });
    assert.equal(cfg.commentsLimit, 2);
  } finally {
    if (prev === undefined) delete process.env.COMMENTS_AUDIT_LIMIT;
    else process.env.COMMENTS_AUDIT_LIMIT = prev;
  }
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

test("resolveCommentsBoardContext parses boardId from board_url", () => {
  const ctx = resolveCommentsBoardContext(
    "https://apptask.ru/c/7/board/54",
  );
  assert.ok(ctx);
  assert.equal(ctx.boardId, "54");
  assert.equal(ctx.boardIdNum, 54);
  assert.equal(ctx.boardUrl, "https://apptask.ru/c/7/board/54");
});

test("isTaskOnBoard rejects task url from another board", () => {
  const t = task({
    id: "1",
    url: "https://apptask.ru/c/7/board/445/1",
  });
  assert.equal(isTaskOnBoard(t, "54"), false);
});

test("enrichTasksWithComments: API error → comments=[], audit helpers ok", async () => {
  const fakePage = {
    context: () => ({
      cookies: async () => [],
    }),
    request: {
      post: async () => ({
        ok: () => false,
        status: () => 500,
        json: async () => ({}),
      }),
    },
  } as unknown as Page;

  const board = resolveCommentsBoardContext(
    "https://apptask.ru/c/7/board/54",
  )!;
  const t = task({
    id: "5765",
    status: "В процессе",
    url: "https://apptask.ru/c/7/board/54/5765",
  });
  const stats = await enrichTasksWithComments(fakePage, [t], {
    mode: "candidates",
    concurrency: 1,
  }, board);

  assert.equal(stats.checkedComments, 1);
  assert.deepEqual(t.comments, []);
  assert.equal(
    findUnresolvedQuestionInCard(t, baseConfig.unresolvedQuestionKeywords),
    null,
  );
});
