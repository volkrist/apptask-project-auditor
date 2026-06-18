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
import { evaluateEntityFindings } from "../../src/rules/evaluate-entity.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { isEntityRule } from "../../src/rules/rule-scopes.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";

test("checkBoardNameTemplate warns on TurboWeave board name", () => {
  const r = checkBoardNameTemplate("TURBO WEAVE (Аутстафф) - Максим Челпанов");
  assert.equal(r.status, "WARN");
  assert.equal(r.strictMatch, false);
  assert.ok(r.deviations.some((d) => /дефис|тире/i.test(d)));
  assert.ok(r.deviations.some((d) => /тег проекта/i.test(d)));
});

test("checkBoardNameTemplate passes strict template", () => {
  const r = checkBoardNameTemplate("TW Turbo Weave (Аутстафф) — Максим Челпанов");
  assert.equal(r.status, "PASS");
  assert.equal(r.strictMatch, true);
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

test("entity board rules evaluated once per board", () => {
  const config = loadAuditConfig({ linkCheckEnabled: false });
  const findings = evaluateEntityFindings(
    {
      config,
      allTasks: [],
      boardMetadata: {
        "783": {
          boardId: 783,
          name: "TURBO WEAVE (Аутстафф) - Максим Челпанов",
          description: null,
          comment: null,
          discordLink: null,
        },
      },
      worksheet: { loaded: false, spreadsheetId: null, projectName: null, projectDescription: null, participants: [], milestones: [] },
    },
    [{ ...emptyRawTask(), boardId: "783" }],
  );
  const boardFolder = findings.filter((f) => f.ruleId === "board_folder_link");
  assert.equal(boardFolder.length, 1);
});

test("isEntityRule marks board and team rules", () => {
  assert.equal(isEntityRule("board_folder_link"), true);
  assert.equal(isEntityRule("verified_success_comment"), false);
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
    ],
    [783],
  );
  assert.equal(daily["783:1"]?.[0]?.hours, 5);
});

test("filterSourceUnavailableSkips excludes NOT_APPLICABLE ui skips", () => {
  const filtered = filterSourceUnavailableSkips([
    {
      ruleId: "ui_has_mockup_link",
      label: "UI",
      count: 50,
      sampleReason: "Не UI/front задача",
    },
  ]);
  assert.equal(filtered.length, 0);
});
