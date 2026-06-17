import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyAuditModeEnv,
  FULL_AUDIT_CONFIG,
  restoreAuditModeEnv,
  TURBOWEAVE_AUDIT_CONFIG,
} from "../../src/config/audit-modes.js";

test("applyAuditModeEnv turboweave sets board 783 only", () => {
  const prev = { ...process.env };
  const snapshot = applyAuditModeEnv("turboweave");
  try {
    assert.equal(process.env.APPTASK_DB_BOARD_IDS, "783");
    assert.equal(process.env.SCRUM_BOARD_IDS, "783");
    assert.equal(
      process.env.AUDIT_DISCORD_CHANNEL_ID,
      TURBOWEAVE_AUDIT_CONFIG.discordChannelId,
    );
    assert.equal(process.env.APPTASK_DB_FALLBACK, "false");
  } finally {
    restoreAuditModeEnv(snapshot);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("applyAuditModeEnv full sets three boards", () => {
  const prev = { ...process.env };
  const snapshot = applyAuditModeEnv("full");
  try {
    assert.equal(process.env.APPTASK_DB_BOARD_IDS, "783,445,54");
    assert.equal(process.env.APPTASK_AUDIT_SCOPE, "multi");
    assert.equal(process.env.SCRUM_BOARD_IDS, "783");
  } finally {
    restoreAuditModeEnv(snapshot);
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("restoreAuditModeEnv reverts overrides", () => {
  const key = "APPTASK_DB_BOARD_IDS";
  const original = process.env[key];
  process.env[key] = "999";
  const snapshot = applyAuditModeEnv("turboweave");
  assert.equal(process.env[key], "783");
  restoreAuditModeEnv(snapshot);
  assert.equal(process.env[key], "999");
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
});
