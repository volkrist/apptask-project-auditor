import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardHasFolderLink,
  boardHasTzSummary,
  checkBoardNameTemplate,
} from "../../src/collectors/board-metadata.js";
import {
  participantNameMatches,
  sprintMilestonesHaveDates,
} from "../../src/worksheet/worksheet-reader.js";
import { aggregateDailyByTask } from "../../src/tracking/tracking-hours-reader.js";
import { filterSourceUnavailableSkips } from "../../src/reports/report-presentation.js";

test("checkBoardNameTemplate accepts manager separator pattern", () => {
  const ok = checkBoardNameTemplate("TURBO WEAVE (Аутстафф) - Максим Челпанов");
  assert.equal(ok.matches, true);
});

test("checkBoardNameTemplate rejects name without manager", () => {
  const bad = checkBoardNameTemplate("Turbo Weave board");
  assert.equal(bad.matches, false);
});

test("boardHasFolderLink detects drive folder", () => {
  const meta = {
    boardId: 1,
    name: "x",
    description: "Папка https://drive.google.com/drive/folders/abc123",
    comment: null,
    discordLink: null,
  };
  assert.equal(boardHasFolderLink(meta), true);
});

test("boardHasTzSummary accepts long description", () => {
  const meta = {
    boardId: 1,
    name: "x",
    description: "А".repeat(90),
    comment: null,
    discordLink: null,
  };
  assert.equal(boardHasTzSummary(meta), true);
});

test("participantNameMatches fuzzy", () => {
  const participants = [
    { name: "Максим Челпанов", status: "Активен", role: "ПМ", rate: null, email: null },
  ];
  assert.equal(participantNameMatches("Челпанов Максим", participants), true);
});

test("sprintMilestonesHaveDates detects missing end dates", () => {
  const r = sprintMilestonesHaveDates([
    { id: "M1", name: "S1", startDate: "14.01.2026", endDate: "20.02.2026" },
    { id: "M2", name: "S2", startDate: "23.02.2026", endDate: null },
  ]);
  assert.equal(r.ok, false);
  assert.ok(r.missing.some((m) => m.includes("M2")));
});

test("aggregateDailyByTask sums hours per user per day", () => {
  const daily = aggregateDailyByTask(
    [
      {
        board_id: 783,
        task_id: 1,
        user_id: 10,
        user_name: "Dev",
        total_time: 5 * 3_600_000,
        append_total_time: 0,
        date: "2026-06-18",
        removed: 0,
      },
      {
        board_id: 783,
        task_id: 1,
        user_id: 10,
        user_name: "Dev",
        total_time: 6 * 3_600_000,
        append_total_time: 0,
        date: "2026-06-18",
        removed: 0,
      },
    ],
    [783],
  );
  assert.equal(daily["783:1"]?.[0]?.hours, 11);
});

test("filterSourceUnavailableSkips excludes NOT_APPLICABLE ui skips", () => {
  const filtered = filterSourceUnavailableSkips([
    {
      ruleId: "ui_has_mockup_link",
      label: "UI",
      count: 50,
      sampleReason: "Не UI/front задача",
    },
    {
      ruleId: "team_worksheet_match",
      label: "Команда",
      count: 64,
      sampleReason: "рабочая таблица проекта не подключена",
    },
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.ruleId, "team_worksheet_match");
});
