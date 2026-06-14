import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditResult } from "../../src/rules/rule-types.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import {
  collectCommentIssues,
  COMMENT_AUDIT_RULE_IDS,
} from "../../src/reports/comment-issues.js";

test("collectCommentIssues includes comment-sourced unresolved and vague done", () => {
  const result: AuditResult = {
    meta: {
      projectName: "t",
      boardUrl: "https://apptask.ru/c/7/board/54",
      auditedAt: "2026-01-01",
      cardsChecked: 1,
      failCount: 1,
      warnCount: 1,
    },
    topIssues: [],
    cards: [
      {
        task: {
          ...emptyRawTask(),
          id: "1",
          boardId: "54",
          url: "https://apptask.ru/c/7/board/54/1",
          title: "Test",
          comments: [
            {
              text: "Готово",
              creatorName: "Alice",
              createTime: "2026-05-01T10:00:00Z",
            },
            {
              text: "Нужно обсудить с клиентом",
              creatorName: "Bob",
              createTime: "2026-05-02T10:00:00Z",
            },
          ],
        },
        results: [
          {
            ruleId: "vague_done_comment",
            status: "WARN",
            reason: "Комментарий без деталей",
          },
          {
            ruleId: "unresolved_question_keywords_in_card",
            status: "FAIL",
            reason: "В комментарии ... обсудить",
          },
        ],
      },
    ],
  };

  const issues = collectCommentIssues(result);
  assert.equal(issues.length, 2);
  assert.ok(COMMENT_AUDIT_RULE_IDS.has("vague_done_comment"));
  assert.equal(
    issues.find((i) => i.ruleId === "vague_done_comment")?.marker,
    "Готово",
  );
});
