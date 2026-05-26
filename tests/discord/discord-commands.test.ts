import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AUDIT_SLASH_COMMANDS,
  COMMENTS_SLASH_COMMANDS,
  LEGACY_AUDIT_COMMANDS,
  LEGACY_AUDIT_DEPRECATION_MESSAGE,
  LEGACY_COMMENTS_COMMANDS,
  LEGACY_COMMENTS_DEPRECATION_MESSAGE,
  LONG_RUNNING_SLASH_COMMANDS,
  UNKNOWN_COMMAND_MESSAGE,
  formatAuditCommentsSlashCommandsForLog,
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
    assert.ok(
      !names.includes(cmd),
      `legacy /${cmd} must not be registered (handler still accepts stale /${cmd})`,
    );
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
  assert.match(botHandlerSrc, /commandName === "audit_full"/);
  assert.match(botHandlerSrc, /resolveAuditMaxCards/);
});

test("/audit_limit runs audit with maxCards from required limit", () => {
  assert.match(botHandlerSrc, /audit-limit-command/);
  assert.match(botHandlerSrc, /getInteger\("limit",\s*true\)/);
});

test("/comments_full uses runCommentsCheck without limit", () => {
  assert.match(botHandlerSrc, /comments-full-command/);
  assert.match(botHandlerSrc, /commandName === "comments_full"/);
  assert.match(botHandlerSrc, /resolveCommentsLimit/);
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

test("LONG_RUNNING does not include legacy audit/comments (deprecation only)", () => {
  for (const cmd of LEGACY_AUDIT_COMMANDS) {
    assert.ok(
      !(LONG_RUNNING_SLASH_COMMANDS as readonly string[]).includes(cmd),
      cmd,
    );
  }
  for (const cmd of LEGACY_COMMENTS_COMMANDS) {
    assert.ok(
      !(LONG_RUNNING_SLASH_COMMANDS as readonly string[]).includes(cmd),
      cmd,
    );
  }
});

test("/audit responds with deprecation message without runAudit", () => {
  assert.match(LEGACY_AUDIT_DEPRECATION_MESSAGE, /Команда \/audit устарела/);
  assert.match(LEGACY_AUDIT_DEPRECATION_MESSAGE, /\/audit_full/);
  assert.match(LEGACY_AUDIT_DEPRECATION_MESSAGE, /\/audit_limit/);
  const start = botHandlerSrc.indexOf("if (isLegacyAuditSlashCommand(cmd))");
  const end = botHandlerSrc.indexOf("if (isLegacyCommentsSlashCommand(cmd))", start);
  const block = botHandlerSrc.slice(start, end);
  assert.ok(block.includes("LEGACY_AUDIT_DEPRECATION_MESSAGE"));
  assert.ok(!block.includes("runAudit"));
  assert.ok(!block.includes("runCommentsCheck"));
});

test("/comments responds with deprecation message without runCommentsCheck", () => {
  assert.match(LEGACY_COMMENTS_DEPRECATION_MESSAGE, /Команда \/comments устарела/);
  assert.match(LEGACY_COMMENTS_DEPRECATION_MESSAGE, /\/comments_full/);
  const start = botHandlerSrc.indexOf("if (isLegacyCommentsSlashCommand(cmd))");
  const end = botHandlerSrc.indexOf("if (isLongRunningSlashCommand(cmd))", start);
  const block = botHandlerSrc.slice(start, end);
  assert.ok(block.includes("LEGACY_COMMENTS_DEPRECATION_MESSAGE"));
  assert.ok(!block.includes("runAudit"));
  assert.ok(!block.includes("runCommentsCheck"));
});

test("unknown command uses UNKNOWN_COMMAND_MESSAGE", () => {
  assert.match(UNKNOWN_COMMAND_MESSAGE, /Команда не поддерживается/);
  assert.match(UNKNOWN_COMMAND_MESSAGE, /\/audit_full/);
  assert.match(botHandlerSrc, /UNKNOWN_COMMAND_MESSAGE/);
});

test("deferReply happens before runAudit and runCommentsCheck", () => {
  const deferIdx = botHandlerSrc.indexOf("await interaction.deferReply");
  const runAuditIdx = botHandlerSrc.indexOf("await runAudit(");
  const runCommentsIdx = botHandlerSrc.indexOf("await runCommentsCheck(");
  const handleAuditIdx = botHandlerSrc.indexOf("async function handleAuditSlash");
  const handleCommentsIdx = botHandlerSrc.indexOf(
    "async function handleCommentsSlash",
  );
  assert.ok(deferIdx >= 0);
  assert.ok(runAuditIdx > deferIdx);
  assert.ok(runCommentsIdx > deferIdx);
  assert.ok(runAuditIdx > handleAuditIdx);
  assert.ok(runCommentsIdx > handleCommentsIdx);
  const dispatchIdx = botHandlerSrc.indexOf("dispatchLongRunningSlash");
  const deferFnIdx = botHandlerSrc.indexOf("async function deferLongRunningReply");
  assert.ok(dispatchIdx > deferFnIdx);
});

test("audit lock busy replies after defer without starting playwright", () => {
  assert.match(botHandlerSrc, /audit lock busy/);
  assert.match(botHandlerSrc, /AUDIT_BUSY_MSG/);
  const runLongIdx = botHandlerSrc.indexOf("async function runLongRunningCommand");
  const runAuditIdx = botHandlerSrc.indexOf("await runAudit(", runLongIdx);
  const busyIdx = botHandlerSrc.indexOf("isAuditBusy()", runLongIdx);
  assert.ok(busyIdx >= 0 && busyIdx < runAuditIdx);
});

test("unknown slash command still defers and editReply", () => {
  assert.match(botHandlerSrc, /unknown command=\//);
  assert.match(botHandlerSrc, /UNKNOWN_COMMAND_MESSAGE/);
});

test("structured discord interaction logs", () => {
  assert.match(botHandlerSrc, /\[discord\] interaction received/);
  assert.match(botHandlerSrc, /\[discord\] deferReply ok/);
  assert.match(botHandlerSrc, /\[discord\] editReply sent/);
  assert.match(botHandlerSrc, /\[discord\] command failed/);
});

test("startup logs guild and registered command options", () => {
  assert.match(botHandlerSrc, /\[discord\] guild id=/);
  assert.match(botHandlerSrc, /formatRegisteredCommandsDetail/);
  assert.match(botHandlerSrc, /formatAuditCommentsSlashCommandsForLog/);
});

test("slash commands replaced log lists only audit and comments commands", () => {
  assert.equal(
    formatAuditCommentsSlashCommandsForLog(),
    "/audit_full, /audit_limit, /comments_full, /comments_limit",
  );
});
