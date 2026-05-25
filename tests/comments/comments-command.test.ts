import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  COMMENT_QUESTION_MARKERS,
  findMarkerHitsInComments,
  findMarkersInPlainText,
  htmlCommentContentToText,
} from "../../src/comments/comment-markers.js";
import { buildCommentsCheckTaskList } from "../../src/app/run-comments-check.js";
import { buildCommentsDetailedMarkdown } from "../../src/comments/write-comments-report.js";
import { resolveCommentsBoard } from "../../src/discord/resolve-board-url.js";

const runCommentsCheckSrc = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/app/run-comments-check.ts",
  ),
  "utf8",
);

test("/comments: full mode when limit omitted", () => {
  const refs = [
    {
      categoryId: "1",
      categoryName: "A",
      columnStateId: null,
      taskId: "5280",
      titlePreview: "Task A",
    },
    {
      categoryId: "1",
      categoryName: "A",
      columnStateId: null,
      taskId: "4885",
      titlePreview: "Task B",
    },
  ];
  const tasks = buildCommentsCheckTaskList(
    "https://apptask.ru/c/7/board/54",
    refs,
  );
  assert.equal(tasks.length, 2);
});

test("/comments: limit=2 → checkedTasks=2", () => {
  const refs = Array.from({ length: 5 }, (_, i) => ({
    categoryId: "1",
    categoryName: "A",
    columnStateId: null,
    taskId: String(5000 + i),
    titlePreview: `T${i}`,
  }));
  const tasks = buildCommentsCheckTaskList(
    "https://apptask.ru/c/7/board/54",
    refs,
    2,
  );
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]!.id, "5000");
  assert.equal(tasks[1]!.id, "5001");
});

test("/comments: uses APPTASK_COMMENTS_BOARD_URL, not APPTASK_BOARD_URL", () => {
  const prevBoard = process.env.APPTASK_BOARD_URL;
  const prevComments = process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_BOARD_URL = "https://apptask.ru/c/7/board/445";
  process.env.APPTASK_COMMENTS_BOARD_URL =
    "https://apptask.ru/c/7/board/54";
  try {
    const r = resolveCommentsBoard(undefined);
    assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/54");
    assert.notEqual(r?.boardUrl, process.env.APPTASK_BOARD_URL);
  } finally {
    if (prevBoard === undefined) delete process.env.APPTASK_BOARD_URL;
    else process.env.APPTASK_BOARD_URL = prevBoard;
    if (prevComments === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prevComments;
  }
});

test("/comments: runCommentsCheck does not call audit or rule engine", () => {
  assert.ok(!runCommentsCheckSrc.includes("runAudit"));
  assert.ok(!runCommentsCheckSrc.includes("buildAuditResult"));
  assert.ok(!runCommentsCheckSrc.includes("evaluateTask"));
  assert.ok(!runCommentsCheckSrc.includes("parseTaskCard"));
  assert.ok(!runCommentsCheckSrc.includes("openTaskCard"));
});

test("HTML comment content is cleaned", () => {
  const plain = htmlCommentContentToText(
    "Нужно <br>уточнить<br> сроки&nbsp;",
  );
  assert.match(plain, /уточнить/i);
  assert.ok(!plain.includes("<br"));
  assert.ok(!plain.includes("&nbsp;"));
});

test("keyword in comment.content appears in comments-detailed", () => {
  const hits = findMarkerHitsInComments(
    "5765",
    "https://apptask.ru/c/7/board/54/5765",
    "Test task",
    [
      {
        id: 1,
        creatorId: 1,
        content: "Пожалуйста, <br>ждем ответ<br>",
        createTime: null,
        parentId: null,
        attachmentList: [],
      },
    ],
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.marker, "ждем ответ");
  assert.match(hits[0]!.commentPlain, /ждем ответ/i);

  const md = buildCommentsDetailedMarkdown({
    boardUrl: "https://apptask.ru/c/7/board/54",
    mode: "limit",
    limit: 2,
    totalTasksOnBoard: 221,
    checkedTasks: 2,
    tasksWithComments: 1,
    totalComments: 4,
    markerHits: hits,
    tasks: [
      {
        taskId: "5765",
        taskUrl: "https://apptask.ru/c/7/board/54/5765",
        title: "Test task",
        commentsCount: 4,
      },
    ],
    durationMs: 8000,
  });
  assert.match(md, /### Задача 5765/);
  assert.match(md, /\*\*Маркер:\*\* ждем ответ/);
  assert.match(md, /уточнить|ждем ответ/i);
});

test("COMMENT_QUESTION_MARKERS includes required phrases", () => {
  assert.ok(COMMENT_QUESTION_MARKERS.includes("уточнить"));
  assert.ok(COMMENT_QUESTION_MARKERS.includes("ждём ответ"));
  assert.deepEqual(
    findMarkersInPlainText("нужно обсудить детали"),
    ["обсудить"],
  );
});
