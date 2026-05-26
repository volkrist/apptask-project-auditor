import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeCommentsReplayHeaders } from "../../src/comments/app-task-comments.js";

test("mergeCommentsReplayHeaders: board sniffer wins over empty", () => {
  const merged = mergeCommentsReplayHeaders(
    { authorization: "Bearer x", "content-type": "application/json" },
    {},
  );
  assert.equal(merged.authorization, "Bearer x");
});

test("mergeCommentsReplayHeaders: later sources override keys", () => {
  const merged = mergeCommentsReplayHeaders(
    { cookie: "a=1" },
    { cookie: "b=2" },
  );
  assert.equal(merged.cookie, "b=2");
});
