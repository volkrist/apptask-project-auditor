import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterTasksForCommentsLoad,
  loadCommentsAuditConfig,
} from "../../src/comments/comments-audit-config.js";
import {
  isSameCommentsBoard,
  resolveCommentsBoardUrl,
} from "../../src/comments/comments-board-context.js";
import { emptyRawTask, type RawTask } from "../../src/adapters/apptask/types.js";

test("comments_board_url not set → uses audit board_url", () => {
  const audit = "https://apptask.ru/c/7/board/445";
  assert.equal(resolveCommentsBoardUrl(audit, undefined), audit);
  assert.equal(resolveCommentsBoardUrl(audit, ""), audit);
});

test("comments_board_url set → uses comments board", () => {
  const audit = "https://apptask.ru/c/7/board/445";
  const comments = "https://apptask.ru/c/7/board/54";
  assert.equal(resolveCommentsBoardUrl(audit, comments), comments);
  assert.equal(isSameCommentsBoard(audit, comments), false);
});

test("comments_limit applies to tasks from comments board list", () => {
  const tasks: RawTask[] = [
    { ...emptyRawTask(), id: "5280", url: "https://apptask.ru/c/7/board/54/5280" },
    { ...emptyRawTask(), id: "4885", url: "https://apptask.ru/c/7/board/54/4885" },
    { ...emptyRawTask(), id: "5551", url: "https://apptask.ru/c/7/board/54/5551" },
  ];
  const selected = filterTasksForCommentsLoad(tasks, {
    mode: "all",
    commentsLimit: 1,
  });
  assert.equal(selected.length, 1);
  assert.equal(selected[0]!.id, "5280");
  assert.match(selected[0]!.url!, /\/board\/54\//);
});

test("comments_mode=off: resolveCommentsBoardUrl still works but config skips load", () => {
  const cfg = loadCommentsAuditConfig({ mode: "off" });
  assert.equal(cfg.mode, "off");
  assert.deepEqual(filterTasksForCommentsLoad([], cfg), []);
});

test("summary URLs: audit 445 vs comments 54", () => {
  const audit = "https://apptask.ru/c/7/board/445";
  const comments = resolveCommentsBoardUrl(
    audit,
    "https://apptask.ru/c/7/board/54",
  );
  assert.notEqual(audit, comments);
  assert.match(comments, /\/board\/54$/);
});
