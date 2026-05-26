import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  buildCommentsDetailedMarkdown,
  buildCommentsSummaryMarkdown,
  writeCommentsReport,
} from "../../src/comments/write-comments-report.js";
import type { CommentMarkerHit } from "../../src/comments/comment-markers.js";

const botHandlerSrc = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/discord/bot.ts",
  ),
  "utf8",
);

const publishCommentsSrc = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/discord/publish-comments.ts",
  ),
  "utf8",
);

const baseInput = {
  boardUrl: "https://apptask.ru/c/7/board/54",
  mode: "limit" as const,
  limit: 1,
  totalTasksOnBoard: 221,
  checkedTasks: 1,
  tasksWithComments: 0,
  totalComments: 0,
  markerHits: [] as CommentMarkerHit[],
  tasks: [
    {
      taskId: "5280",
      taskUrl: "https://apptask.ru/c/7/board/54/5280",
      title: "Sample",
      commentsCount: 0,
    },
  ],
  durationMs: 1200,
  checkedAt: new Date("2026-05-25T10:00:00.000Z"),
};

test("comments report creates comments-summary.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comments-report-"));
  const out = writeCommentsReport(baseInput, dir);
  assert.ok(fs.existsSync(out.summaryPath));
  const md = fs.readFileSync(out.summaryPath, "utf8");
  assert.match(md, /# Проверка комментариев AppTask/);
  assert.match(md, /\*\*Проверено:\*\* 1 из 221/);
  assert.match(md, /Режим:\*\* limit 1/);
});

test("comments report creates comments-detailed.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comments-report-"));
  const out = writeCommentsReport(baseInput, dir);
  assert.ok(fs.existsSync(out.detailedPath));
  const md = fs.readFileSync(out.detailedPath, "utf8");
  assert.match(md, /# Детальный отчёт по комментариям/);
  assert.match(md, /Проверено задач \| 1 из 221/);
});

test("comments report creates comments.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comments-report-"));
  const out = writeCommentsReport(baseInput, dir);
  assert.ok(fs.existsSync(out.jsonPath));
  const data = JSON.parse(fs.readFileSync(out.jsonPath, "utf8")) as {
    meta: { mode: string; limit: number; checkedTasks: number };
    tasks: Array<{ taskId: number; commentsCount: number }>;
  };
  assert.equal(data.meta.mode, "limit");
  assert.equal(data.meta.limit, 1);
  assert.equal(data.meta.checkedTasks, 1);
  assert.equal(data.tasks[0]!.taskId, 5280);
  assert.equal(data.tasks[0]!.commentsCount, 0);
});

test("if markers=0, detailed contains Не найдено", () => {
  const md = buildCommentsDetailedMarkdown(baseInput);
  assert.match(md, /## Найденные маркеры/);
  assert.match(md, /Не найдено\./);
});

test("summary: no markers → итог без нарушений", () => {
  const md = buildCommentsSummaryMarkdown(baseInput);
  assert.match(md, /Нарушения по комментариям не найдены/);
});

test("detailed with markers lists task and comment fields", () => {
  const hit: CommentMarkerHit = {
    taskId: "5765",
    taskUrl: "https://apptask.ru/c/7/board/54/5765",
    taskTitle: "Test",
    commentId: 59541,
    creatorId: 8280,
    createTime: "2026-05-20",
    marker: "уточнить",
    commentPlain: "нужно уточнить срок",
  };
  const md = buildCommentsDetailedMarkdown({
    ...baseInput,
    markerHits: [hit],
  });
  assert.match(md, /### Задача 5765/);
  assert.match(md, /Комментарий ID:\*\* 59541/);
  assert.match(md, /Автор ID:\*\* 8280/);
  assert.match(md, /Маркер:\*\* уточнить/);
  assert.ok(!md.includes("Не найдено."));
});

test("Discord handler attaches 3 report files", () => {
  assert.match(publishCommentsSrc, /comments-summary\.md/);
  assert.match(publishCommentsSrc, /comments-detailed\.md/);
  assert.match(publishCommentsSrc, /comments\.json/);
  assert.match(botHandlerSrc, /publishFullCommentsReportToChannel/);
  assert.match(botHandlerSrc, /Report files/);
  assert.ok(!publishCommentsSrc.includes("path.resolve(out.outputDir)"));
});

test("/comments_limit does not start ordinary audit", () => {
  const block = botHandlerSrc.slice(
    botHandlerSrc.indexOf("async function handleCommentsSlash"),
    botHandlerSrc.indexOf("async function handleAuditSlash"),
  );
  assert.ok(block.includes("runCommentsCheck"));
  assert.ok(!block.includes("runAudit"));
});

test("/comments_full does not start ordinary audit", () => {
  assert.match(botHandlerSrc, /comments-full-command/);
  assert.match(botHandlerSrc, /comments-limit-command/);
  assert.ok(!botHandlerSrc.includes("handleAuditCommand"));
});
