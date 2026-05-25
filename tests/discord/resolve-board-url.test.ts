import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBoardUrl,
  resolveAuditBoard,
  resolveBoardUrl,
  resolveCommentsBoard,
} from "../../src/discord/resolve-board-url.js";

test("resolveBoardUrl: plain URL", () => {
  assert.equal(
    resolveBoardUrl("https://apptask.ru/c/7/board/54"),
    "https://apptask.ru/c/7/board/54",
  );
});

test("resolveBoardUrl: board id only", () => {
  assert.equal(resolveBoardUrl("54"), buildBoardUrl(54));
});

test("resolveBoardUrl: Excel HYPERLINK", () => {
  assert.equal(
    resolveBoardUrl('=HYPERLINK("https://apptask.ru/c/7/board/445","доска")'),
    "https://apptask.ru/c/7/board/445",
  );
});

test("resolveAuditBoard: board_id wins over env", () => {
  const r = resolveAuditBoard(
    undefined,
    54,
    "https://apptask.ru/c/7/board/445",
  );
  assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/54");
  assert.equal(r?.source, "board_id");
});

test("resolveAuditBoard: env when no options", () => {
  const r = resolveAuditBoard(
    undefined,
    null,
    "https://apptask.ru/c/7/board/445",
  );
  assert.equal(r?.source, "env");
  assert.match(r!.boardUrl, /\/board\/445$/);
});

test("resolveCommentsBoard: APPTASK_COMMENTS_BOARD_URL when option omitted", () => {
  const r = resolveCommentsBoard(
    undefined,
    "https://apptask.ru/c/7/board/54",
  );
  assert.equal(r?.source, "APPTASK_COMMENTS_BOARD_URL");
  assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/54");
});

test("resolveCommentsBoard: option wins over comments env", () => {
  const r = resolveCommentsBoard(
    "https://apptask.ru/c/7/board/12",
    "https://apptask.ru/c/7/board/54",
  );
  assert.equal(r?.source, "board_url");
  assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/12");
});
