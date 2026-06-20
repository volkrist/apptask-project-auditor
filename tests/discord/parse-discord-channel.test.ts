import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiscordChannelRef } from "../../src/discord/parse-discord-channel.js";
import {
  resolveAppTaskDiscordChannel,
  boardIdsFromAuditBoardUrl,
} from "../../src/collectors/board-discord-channel.js";
import { resolveAuditPublishChannel } from "../../src/discord/publish-report.js";

test("parseDiscordChannelRef extracts channel from discord.com URL", () => {
  assert.equal(
    parseDiscordChannelRef(
      "https://discord.com/channels/123456789012345678/987654321098765432",
    ),
    "987654321098765432",
  );
});

test("parseDiscordChannelRef accepts raw snowflake", () => {
  assert.equal(parseDiscordChannelRef("987654321098765432"), "987654321098765432");
});

test("parseDiscordChannelRef returns null for empty or invalid", () => {
  assert.equal(parseDiscordChannelRef(null), null);
  assert.equal(parseDiscordChannelRef("not-a-link"), null);
});

test("resolveAppTaskDiscordChannel picks first board with link", () => {
  const meta = {
    "783": {
      boardId: 783,
      name: "A",
      description: null,
      comment: null,
      discordLink:
        "https://discord.com/channels/111/222222222222222222",
    },
    "445": {
      boardId: 445,
      name: "B",
      description: null,
      comment: null,
      discordLink: null,
    },
  };
  const r = resolveAppTaskDiscordChannel(meta, ["445", "783"]);
  assert.equal(r.channelId, "222222222222222222");
  assert.equal(r.boardId, "783");
});

test("resolveAuditPublishChannel prefers AppTask over env", () => {
  const prev = process.env.AUDIT_DISCORD_CHANNEL_ID;
  process.env.AUDIT_DISCORD_CHANNEL_ID = "env-channel-id";
  try {
    const r = resolveAuditPublishChannel({
      apptaskDiscordChannelId: "apptask-channel-id",
      apptaskBoardId: "783",
    });
    assert.equal(r.channelId, "apptask-channel-id");
    assert.equal(r.source, "apptask_board");
    assert.equal(r.boardId, "783");
  } finally {
    if (prev === undefined) delete process.env.AUDIT_DISCORD_CHANNEL_ID;
    else process.env.AUDIT_DISCORD_CHANNEL_ID = prev;
  }
});

test("resolveAuditPublishChannel uses invoke channel before env", () => {
  const prev = process.env.AUDIT_DISCORD_CHANNEL_ID;
  process.env.AUDIT_DISCORD_CHANNEL_ID = "env-channel-id";
  try {
    const r = resolveAuditPublishChannel({
      invokeChannelId: "invoke-channel-id",
    });
    assert.equal(r.channelId, "invoke-channel-id");
    assert.equal(r.source, "invoke_channel");
  } finally {
    if (prev === undefined) delete process.env.AUDIT_DISCORD_CHANNEL_ID;
    else process.env.AUDIT_DISCORD_CHANNEL_ID = prev;
  }
});

test("boardIdsFromAuditBoardUrl parses comma-separated URLs", () => {
  assert.deepEqual(
    boardIdsFromAuditBoardUrl(
      "https://apptask.ru/c/7/board/783, https://apptask.ru/c/7/board/445",
    ),
    ["783", "445"],
  );
});
