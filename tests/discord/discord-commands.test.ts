import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AUDIT_SLASH_COMMANDS,
  COMMENTS_SLASH_COMMANDS,
  getCommandOptionNames,
  slashCommands,
} from "../../src/discord/slash-commands.js";
import {
  resolveCommentsBoard,
  resolveBoardUrl,
} from "../../src/discord/resolve-board-url.js";

const botHandlerSrc = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/discord/bot.ts",
  ),
  "utf8",
);

const REMOVED_OPTIONS = [
  "board_id",
  "comments_mode",
  "comments_limit",
  "comments_board_url",
];

const LEGACY_COMMANDS = ["audit", "comments"];

test("slash commands are exactly audit_full, audit_limit, comments_full, comments_limit (+ projects)", () => {
  const names = slashCommands.map((c) => c.name);
  for (const cmd of LEGACY_COMMANDS) {
    assert.ok(!names.includes(cmd), `legacy /${cmd} must be removed`);
  }
  assert.ok(names.includes("audit_full"));
  assert.ok(names.includes("audit_limit"));
  assert.ok(names.includes("comments_full"));
  assert.ok(names.includes("comments_limit"));
});

test("/audit_full: only board_url optional", () => {
  assert.deepEqual(getCommandOptionNames("audit_full"), ["board_url"]);
});

test("/audit_limit: limit required then board_url optional (Discord order)", () => {
  assert.deepEqual(getCommandOptionNames("audit_limit"), ["limit", "board_url"]);
});

test("/comments_full: board_url optional", () => {
  assert.deepEqual(getCommandOptionNames("comments_full"), ["board_url"]);
});

test("/comments_limit: limit required, board_url optional (Discord order)", () => {
  assert.deepEqual(getCommandOptionNames("comments_limit"), [
    "limit",
    "board_url",
  ]);
});

test("no removed comment/audit options in any command", () => {
  for (const cmd of slashCommands) {
    for (const opt of getCommandOptionNames(cmd.name)) {
      assert.ok(!REMOVED_OPTIONS.includes(opt), `${cmd.name}.${opt}`);
    }
  }
});

test("/audit handlers always pass commentsAuditMode off", () => {
  assert.match(botHandlerSrc, /commentsAuditMode:\s*"off"/);
  for (const removed of REMOVED_OPTIONS) {
    assert.ok(!botHandlerSrc.includes(`getString("${removed}")`));
    assert.ok(!botHandlerSrc.includes(`getInteger("${removed}")`));
  }
});

test("/audit_full runs audit without maxCards", () => {
  assert.match(botHandlerSrc, /audit-full-command/);
  assert.match(botHandlerSrc, /maxCards:\s*undefined/);
});

test("/audit_limit runs audit with maxCards from required limit", () => {
  assert.match(botHandlerSrc, /audit-limit-command/);
  assert.match(botHandlerSrc, /getInteger\("limit",\s*true\)/);
});

test("/comments_full uses runCommentsCheck without limit", () => {
  assert.match(botHandlerSrc, /comments-full-command/);
  assert.match(botHandlerSrc, /limit:\s*undefined/);
  assert.ok(!botHandlerSrc.includes("handleCommentsCommand"));
  assert.match(botHandlerSrc, /buildCommentsReportAttachments/);
});

test("/comments_limit uses runCommentsCheck with limit, not runAudit", () => {
  assert.match(botHandlerSrc, /comments-limit-command/);
  const commentsBlock = botHandlerSrc.slice(
    botHandlerSrc.indexOf("async function handleCommentsSlash"),
    botHandlerSrc.indexOf("async function handleAuditSlash"),
  );
  assert.ok(commentsBlock.includes("runCommentsCheck"));
  assert.ok(!commentsBlock.includes("runAudit"));
});

test("comments commands use resolveCommentsBoard, not APPTASK_BOARD_URL", () => {
  const commentsBlock = botHandlerSrc.slice(
    botHandlerSrc.indexOf("async function handleCommentsSlash"),
    botHandlerSrc.indexOf("async function handleAuditSlash"),
  );
  assert.ok(commentsBlock.includes("resolveCommentsBoard"));
  assert.ok(!commentsBlock.includes("APPTASK_BOARD_URL"));
  assert.ok(!commentsBlock.includes("resolveAuditBoard"));
});

test("/comments_limit without board_url uses APPTASK_COMMENTS_BOARD_URL", () => {
  const prevBoard = process.env.APPTASK_BOARD_URL;
  const prevComments = process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_BOARD_URL = "https://apptask.ru/c/7/board/445";
  process.env.APPTASK_COMMENTS_BOARD_URL =
    "https://apptask.ru/c/7/board/54";
  try {
    const r = resolveCommentsBoard(undefined);
    assert.equal(r?.source, "APPTASK_COMMENTS_BOARD_URL");
    assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/54");
  } finally {
    if (prevBoard === undefined) delete process.env.APPTASK_BOARD_URL;
    else process.env.APPTASK_BOARD_URL = prevBoard;
    if (prevComments === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prevComments;
  }
});

test("/comments_full without board_url uses APPTASK_COMMENTS_BOARD_URL", () => {
  const prev = process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_COMMENTS_BOARD_URL =
    "https://apptask.ru/c/7/board/54";
  try {
    const r = resolveCommentsBoard(undefined);
    assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/54");
  } finally {
    if (prev === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prev;
  }
});

test("comments: explicit board_url overrides env", () => {
  const prevComments = process.env.APPTASK_COMMENTS_BOARD_URL;
  const prevBoard = process.env.APPTASK_BOARD_URL;
  process.env.APPTASK_COMMENTS_BOARD_URL =
    "https://apptask.ru/c/7/board/54";
  process.env.APPTASK_BOARD_URL = "https://apptask.ru/c/7/board/445";
  try {
    const r = resolveCommentsBoard("https://apptask.ru/c/7/board/99");
    assert.equal(r?.source, "board_url");
    assert.equal(r?.boardUrl, "https://apptask.ru/c/7/board/99");
  } finally {
    if (prevComments === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prevComments;
    if (prevBoard === undefined) delete process.env.APPTASK_BOARD_URL;
    else process.env.APPTASK_BOARD_URL = prevBoard;
  }
});

test("comments: never uses APPTASK_BOARD_URL when comments env set", () => {
  const prevComments = process.env.APPTASK_COMMENTS_BOARD_URL;
  const prevBoard = process.env.APPTASK_BOARD_URL;
  delete process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_BOARD_URL = "https://apptask.ru/c/7/board/445";
  try {
    assert.equal(resolveCommentsBoard(undefined), null);
  } finally {
    if (prevComments === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prevComments;
    if (prevBoard === undefined) delete process.env.APPTASK_BOARD_URL;
    else process.env.APPTASK_BOARD_URL = prevBoard;
  }
});

test("comments: error when no board_url and no APPTASK_COMMENTS_BOARD_URL", () => {
  const prev = process.env.APPTASK_COMMENTS_BOARD_URL;
  delete process.env.APPTASK_COMMENTS_BOARD_URL;
  try {
    assert.equal(resolveCommentsBoard(undefined), null);
    assert.match(
      botHandlerSrc,
      /Не указан board_url и не задан APPTASK_COMMENTS_BOARD_URL/,
    );
  } finally {
    if (prev === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prev;
  }
});

test("AUDIT_SLASH_COMMANDS and COMMENTS_SLASH_COMMANDS constants", () => {
  assert.deepEqual(AUDIT_SLASH_COMMANDS, ["audit_full", "audit_limit"]);
  assert.deepEqual(COMMENTS_SLASH_COMMANDS, [
    "comments_full",
    "comments_limit",
  ]);
});
