import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import {
  artifactLinksPresentRule,
  taskHasArtifactLinks,
} from "../../src/rules/hard/artifact-links-present.js";
import {
  isMockupCreationTask,
  requiresExistingMockupLink,
} from "../../src/rules/task-ui.js";
import {
  uiHasMockupLinkRule,
  uiMockupApprovedRule,
} from "../../src/rules/contract/contract-rules.js";

const config = loadAuditConfig({ linkCheckEnabled: false });

test("taskHasArtifactLinks: ссылка на ТЗ в описании", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText:
      "ТЗ https://docs.google.com/document/d/abc/edit",
  };
  assert.equal(taskHasArtifactLinks(task, config), true);
});

test("taskHasArtifactLinks: Google Sheets (задача в смете) — true", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText: "Смета https://docs.google.com/spreadsheets/d/abc/edit",
  };
  assert.equal(taskHasArtifactLinks(task, config), true);
});

test("artifactLinksPresentRule: только ТЗ → PASS", () => {
  const task = {
    ...emptyRawTask(),
    links: ["https://docs.google.com/document/d/tz/edit"],
  };
  const r = artifactLinksPresentRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});

test("artifactLinksPresentRule: пустая карточка → FAIL", () => {
  const r = artifactLinksPresentRule.evaluate(emptyRawTask(), { config, allTasks: [] });
  assert.equal(r.status, "FAIL");
});

test("isMockupCreationTask: тег дизайн", () => {
  const task = { ...emptyRawTask(), title: "3.2.1 UI: HUD", tags: ["дизайн"] };
  assert.equal(isMockupCreationTask(task, config), true);
});

test("requiresExistingMockupLink: TurboWeave UI: HUD (UI/UX) — false", () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: HUD (UI/UX)",
    tags: ["доработка"],
    category: "Frontend",
  };
  assert.equal(requiresExistingMockupLink(task, config), false);
});

test("requiresExistingMockupLink: явная вёрстка по макету — true", () => {
  const task = {
    ...emptyRawTask(),
    title: "Верстка по макету — главная",
    category: "Frontend",
  };
  assert.equal(requiresExistingMockupLink(task, config), true);
});

test("ui_has_mockup_link: TurboWeave UI/UX без Figma → NOT_APPLICABLE", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: HUD (UI/UX)",
    tags: ["доработка"],
    descriptionText: "ТЗ https://docs.google.com/document/d/tz/edit",
  };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
  assert.match(r.reason, /создание UI/i);
});

test("ui_has_mockup_link: задача на дизайн → NOT_APPLICABLE", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: Дизайн HUD",
    tags: ["дизайн"],
  };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
  assert.match(r.reason, /создание UI|создание макета/i);
});

test("ui_has_mockup_link: вёрстка по макету с ТЗ но без Figma → FAIL", async () => {
  const task = {
    ...emptyRawTask(),
    title: "Верстка по макету — HUD",
    tags: ["доработка"],
    descriptionText: "ТЗ https://docs.google.com/document/d/tz/edit",
  };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /ТЗ не заменяет макет/i);
});

test("ui_has_mockup_link: вёрстка по макету с Figma → PASS", async () => {
  const task = {
    ...emptyRawTask(),
    title: "Верстка по макету — HUD",
    tags: ["доработка"],
    links: ["https://www.figma.com/file/abc/hud"],
  };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});

test("ui_mockup_approved: задача на дизайн с комментарием → PASS", async () => {
  const task = {
    ...emptyRawTask(),
    title: "3.2.1 UI: HUD (UI/UX)",
    category: "UI/UX",
    comments: [
      {
        text: "С заказчиком согласовано, задачу закрываю",
        creatorName: "PM",
      },
    ],
  };
  const r = await uiMockupApprovedRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /согласован/i);
});

test("ui_mockup_approved: front без маркера → WARN", async () => {
  const task = {
    ...emptyRawTask(),
    title: "Верстка по макету главной (front)",
    descriptionText: "Сверстать по Figma",
  };
  const r = await uiMockupApprovedRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "WARN");
});

test("ui_mockup_approved: макет согласован в описании → PASS", async () => {
  const task = {
    ...emptyRawTask(),
    title: "Верстка по макету главной (front)",
    descriptionText: "Макет согласован с заказчиком 12.01",
  };
  const r = await uiMockupApprovedRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "PASS");
});
