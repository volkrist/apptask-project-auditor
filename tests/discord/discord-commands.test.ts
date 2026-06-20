import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  AUDIT_SLASH_COMMANDS,
  COMMENTS_SLASH_COMMANDS,
  IGNORE_SLASH_COMMANDS,
  PROJECT_SLASH_COMMANDS,
  REGISTERED_SLASH_COMMANDS,
  getCommandOptionNames,
  UNSUPPORTED_COMMAND_MESSAGE,
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

const REMOVED_COMMANDS = ["comments"];

test("slash commands: /audit, /turboweave + screenshot commands only", () => {
  const names = slashCommands.map((c) => c.name);
  for (const cmd of REMOVED_COMMANDS) {
    assert.ok(!names.includes(cmd), `removed /${cmd} must not be registered`);
  }
  assert.ok(names.includes("audit"));
  assert.ok(names.includes("turboweave"));
  assert.ok(names.includes("audit_full"));
  assert.ok(names.includes("audit_limit"));
  assert.ok(names.includes("comments_full"));
  assert.ok(names.includes("comments_limit"));
  assert.ok(names.includes("project_add"));
  assert.ok(names.includes("project_list"));
  assert.ok(names.includes("project_remove"));
  assert.ok(names.includes("audit_ignore"));
  assert.deepEqual(names.sort(), [...REGISTERED_SLASH_COMMANDS].sort());
});

test("/audit: no options (multi-board 783,445,54,789 only)", () => {
  assert.deepEqual(getCommandOptionNames("audit"), []);
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

test("/audit handlers apply full audit mode and commentsAuditMode off", () => {
  assert.match(botHandlerSrc, /auditMode: "full"/);
  assert.match(botHandlerSrc, /commentsAuditMode: "off"/);
});

test("/audit_full runs audit without maxCards", () => {
  assert.match(botHandlerSrc, /audit-full-command/);
  assert.match(botHandlerSrc, /maxCards: undefined/);
});

test("/audit_limit runs audit with maxCards from required limit", () => {
  assert.match(botHandlerSrc, /audit-limit-command/);
  assert.match(botHandlerSrc, /getInteger\("limit", true\)/);
});

test("/comments_full uses runCommentsCheck without limit", () => {
  assert.match(botHandlerSrc, /comments-full-command/);
  assert.match(botHandlerSrc, /limit: undefined/);
});

test("/comments_limit uses runCommentsCheck with limit, not runAudit", () => {
  assert.match(botHandlerSrc, /comments-limit-command/);
  assert.match(botHandlerSrc, /runCommentsCheck/);
  const commentsLimitBlock = botHandlerSrc.slice(
    botHandlerSrc.indexOf("comments-limit-command"),
    botHandlerSrc.indexOf("comments-limit-command") + 800,
  );
  assert.ok(!commentsLimitBlock.includes("runAudit("));
});

test("comments commands use resolveCommentsBoard, not APPTASK_BOARD_URL", () => {
  assert.match(botHandlerSrc, /resolveCommentsBoard/);
});

test("/comments_limit without board_url uses APPTASK_COMMENTS_BOARD_URL", () => {
  const prev = process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_COMMENTS_BOARD_URL = "https://apptask.ru/c/7/board/54";
  try {
    const resolved = resolveCommentsBoard(undefined);
    assert.ok(resolved);
    assert.equal(resolved!.boardUrl, "https://apptask.ru/c/7/board/54");
  } finally {
    if (prev === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prev;
  }
});

test("/comments_full without board_url uses APPTASK_COMMENTS_BOARD_URL", () => {
  const prev = process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_COMMENTS_BOARD_URL = "https://apptask.ru/c/7/board/445";
  try {
    const resolved = resolveCommentsBoard(undefined);
    assert.ok(resolved);
    assert.equal(resolved!.source, "APPTASK_COMMENTS_BOARD_URL");
  } finally {
    if (prev === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prev;
  }
});

test("comments: explicit board_url overrides env", () => {
  const prev = process.env.APPTASK_COMMENTS_BOARD_URL;
  process.env.APPTASK_COMMENTS_BOARD_URL = "https://apptask.ru/c/7/board/54";
  try {
    const resolved = resolveCommentsBoard("https://apptask.ru/c/7/board/783");
    assert.ok(resolved);
    assert.equal(resolved!.boardUrl, "https://apptask.ru/c/7/board/783");
    assert.equal(resolved!.source, "board_url");
  } finally {
    if (prev === undefined) delete process.env.APPTASK_COMMENTS_BOARD_URL;
    else process.env.APPTASK_COMMENTS_BOARD_URL = prev;
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

test("slash command groups", () => {
  assert.deepEqual(AUDIT_SLASH_COMMANDS, ["audit", "audit_full", "audit_limit"]);
  assert.deepEqual(COMMENTS_SLASH_COMMANDS, [
    "comments_full",
    "comments_limit",
  ]);
  assert.deepEqual(PROJECT_SLASH_COMMANDS, [
    "project_add",
    "project_list",
    "project_remove",
  ]);
  assert.deepEqual(IGNORE_SLASH_COMMANDS, [
    "audit_ignore",
    "audit_unignore",
    "audit_ignored_list",
  ]);
});

test("/audit runs full multi-board audit", () => {
  assert.match(botHandlerSrc, /audit-command/);
  assert.match(botHandlerSrc, /multiBoardAudit: true/);
  const auditCmdBlock = botHandlerSrc.slice(
    botHandlerSrc.indexOf('if (cmd === "audit")'),
    botHandlerSrc.indexOf('if (cmd === "audit_full")'),
  );
  assert.ok(!auditCmdBlock.includes('getInteger("limit"'));
});

test("legacy /comments handler removed", () => {
  assert.ok(!botHandlerSrc.includes('cmd === "comments"'));
});

test("unknown command replies with supported command list", () => {
  assert.match(UNSUPPORTED_COMMAND_MESSAGE, /Команда не поддерживается/);
  assert.match(UNSUPPORTED_COMMAND_MESSAGE, /\/project_add/);
  assert.match(botHandlerSrc, /UNSUPPORTED_COMMAND_MESSAGE/);
});

test("auto-learn channel mapping on slash audit", () => {
  assert.match(botHandlerSrc, /learnProjectChannelFromSlash/);
  assert.match(botHandlerSrc, /syncAppTaskDiscordChannelMappings/);
});

test("resolveBoardUrl: plain URL", () => {
  assert.equal(
    resolveBoardUrl("https://apptask.ru/c/7/board/445"),
    "https://apptask.ru/c/7/board/445",
  );
});

test("resolveBoardUrl: board id only", () => {
  assert.equal(resolveBoardUrl("445"), "https://apptask.ru/c/7/board/445");
});

test("resolveBoardUrl: Excel HYPERLINK", () => {
  assert.equal(
    resolveBoardUrl('=HYPERLINK("https://apptask.ru/c/7/board/783"; "783")'),
    "https://apptask.ru/c/7/board/783",
  );
});
