import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuditorChannelName } from "../../src/discord/auditor-channel.js";
import { resolveAuditPublishChannel } from "../../src/discord/publish-report.js";

test("isAuditorChannelName matches auditor section names", () => {
  assert.equal(isAuditorChannelName("аудитор"), true);
  assert.equal(isAuditorChannelName("Auditor"), true);
  assert.equal(isAuditorChannelName("общий"), false);
});

test("resolveAuditPublishChannel uses guild auditor before invoke channel", () => {
  const resolved = resolveAuditPublishChannel({
    guildAuditorChannelId: "111",
    invokeChannelId: "222",
  });
  assert.equal(resolved.channelId, "111");
  assert.equal(resolved.source, "guild_auditor");
});
