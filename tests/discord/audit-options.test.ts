import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCommentsAuditMode,
  resolveCommentsAuditLimit,
} from "../../src/discord/audit-options.js";

test("parseCommentsAuditMode: valid values", () => {
  assert.equal(parseCommentsAuditMode("off"), "off");
  assert.equal(parseCommentsAuditMode("candidates"), "candidates");
  assert.equal(parseCommentsAuditMode("all"), "all");
  assert.equal(parseCommentsAuditMode(null), undefined);
  assert.equal(parseCommentsAuditMode("invalid"), undefined);
});

test("resolveCommentsAuditLimit: Discord overrides env", () => {
  assert.equal(resolveCommentsAuditLimit(2, "10"), 2);
  assert.equal(resolveCommentsAuditLimit(null, "10"), 10);
  assert.equal(resolveCommentsAuditLimit(undefined, ""), undefined);
});

test("resolveCommentsAuditLimit: clamps to 1..300", () => {
  assert.equal(resolveCommentsAuditLimit(0, undefined), 1);
  assert.equal(resolveCommentsAuditLimit(999, undefined), 300);
});

test("resolveCommentsAuditLimit: Discord integer as audit input", () => {
  const discordLimit = 2;
  const commentsAuditLimit = resolveCommentsAuditLimit(
    discordLimit,
    process.env.COMMENTS_AUDIT_LIMIT,
  );
  assert.equal(commentsAuditLimit, 2);
});
