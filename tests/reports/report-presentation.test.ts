import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterSourceUnavailableSkips,
  humanizeProfileLabel,
  humanizeSourcesUsed,
  simplifyReasonText,
} from "../../src/reports/report-presentation.js";

test("humanizeProfileLabel hides internal id", () => {
  assert.equal(humanizeProfileLabel("contract_turboweave_v1"), "TurboWeave");
});

test("humanizeSourcesUsed uses Russian labels", () => {
  const text = humanizeSourcesUsed(["AppTask DB", "Scrum", "tracking-hours"]);
  assert.match(text, /карточки AppTask/);
  assert.match(text, /смета Scrum/);
  assert.match(text, /учёт фактического времени/);
  assert.doesNotMatch(text, /tracking-hours/);
});

test("filterSourceUnavailableSkips hides applicability skips", () => {
  const filtered = filterSourceUnavailableSkips([
    {
      ruleId: "ui_has_mockup_link",
      label: "Нет ссылки на макет (UI)",
      count: 63,
      sampleReason: "Не UI/front задача",
    },
    {
      ruleId: "board_name_template",
      label: "Название доски",
      count: 64,
      sampleReason: "данные о названии доски не найдены в доступных источниках",
    },
    {
      ruleId: "team_worksheet_match",
      label: "Команда",
      count: 64,
      sampleReason: "рабочая таблица проекта не подключена",
    },
  ]);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((s) => s.ruleId !== "ui_has_mockup_link"));
});

test("simplifyReasonText rounds hours and strips confidence", () => {
  const out = simplifyReasonText(
    "На проверке 2 д (48 ч) (confidence=fallback_update_time)",
  );
  assert.doesNotMatch(out, /confidence/);
});
