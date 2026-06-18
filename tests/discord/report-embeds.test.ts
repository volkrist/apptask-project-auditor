import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAuditReportEmbed,
  buildCommentsReportEmbed,
  buildRecommendations,
  getAuditStatusText,
  getCommentsStatusText,
  humanizeRuleLabel,
} from "../../src/discord/report-embeds.js";
import type { RunAuditResult } from "../../src/app/run-audit.js";
import type { RunCommentsCheckResult } from "../../src/app/run-comments-check.js";

test("humanizeRuleLabel uses readable labels with fallback", () => {
  assert.equal(humanizeRuleLabel("deadline_present", "Deadline"), "Нет дедлайна");
  assert.equal(humanizeRuleLabel("unknown_rule", "Custom label"), "Custom label");
});

test("buildRecommendations returns up to four unique actions", () => {
  const out = buildRecommendations([
    { ruleId: "deadline_present" },
    { ruleId: "artifact_links_present" },
    { ruleId: "deadline_present" },
    { ruleId: "description_present" },
    { ruleId: "assignee_present" },
    { ruleId: "estimate_present" },
  ]);
  assert.deepEqual(out, [
    "Заполнить дедлайны",
    "Добавить ссылки на ТЗ, макеты, документы или репозитории",
    "Заполнить описание задачи",
    "Назначить ответственных исполнителей",
  ]);
});

test("audit status text is derived from FAIL/WARN", () => {
  assert.equal(getAuditStatusText(1, 0), "Требует доработки");
  assert.equal(getAuditStatusText(0, 2), "Есть предупреждения");
  assert.equal(getAuditStatusText(0, 0), "Проблем не найдено");
});

test("comments status text is derived from markers", () => {
  assert.equal(getCommentsStatusText(3), "Есть вопросы для проверки");
  assert.equal(getCommentsStatusText(0), "Маркеры не найдены");
});

test("buildAuditReportEmbed is short notification with single file hint", () => {
  const auditOut = {
    totalOnBoard: 79,
    result: {
      meta: {
        projectName: "TurboWeave",
        boardUrl: "https://apptask.ru/c/7/board/783",
        auditedAt: "2026-05-28T00:00:00Z",
        cardsChecked: 65,
        failCount: 5,
        warnCount: 1,
        excludedFlowTasks: 14,
        auditProfile: "contract_turboweave_v1",
      },
      topIssues: [],
      cards: [],
    },
    output: {
      dir: "output/audit",
      summaryPath: "summary.md",
      markdownPath: "audit.md",
      jsonPath: "audit.json",
      reportPath: "audit-report.md",
      humanSummaryPath: "human-summary.md",
    },
    discordPublished: false,
  } as RunAuditResult;

  const embed = buildAuditReportEmbed(auditOut);
  const json = embed.toJSON();
  assert.equal(json.title, "Аудит TurboWeave");
  assert.ok(String(json.description).includes("audit-report.md"));
  assert.ok(json.fields?.some((f) => f.name === "Сводка" && String(f.value).includes("Исключено потоковых")));
  assert.ok(!json.fields?.some((f) => f.name === "Главные проблемы"));
});

test("buildCommentsReportEmbed includes status", () => {
  const commentsOut: RunCommentsCheckResult = {
    boardUrl: "https://apptask.ru/c/7/board/54",
    mode: "full",
    limit: null,
    totalTasksOnBoard: 20,
    checkedTasks: 20,
    tasksWithComments: 10,
    totalComments: 15,
    markerHits: [],
    durationMs: 1000,
    output: {
      dir: "output/comments",
      summaryPath: "comments-summary.md",
      detailedPath: "comments-detailed.md",
      jsonPath: "comments.json",
      reportPath: "comments-report.md",
    },
  };
  const embed = buildCommentsReportEmbed(commentsOut);
  const json = embed.toJSON();
  assert.equal(json.title, "✅ Проверка комментариев завершена");
  assert.ok(json.fields?.some((f) => f.name === "Общий статус" && f.value === "Маркеры не найдены"));
});
