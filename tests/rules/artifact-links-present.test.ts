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

test("requiresExistingMockupLink: 4.1 (front) с парой (UI/UX) — true", () => {
  const design = {
    ...emptyRawTask(),
    id: "101",
    boardId: "783",
    title: "4.1 Экран пользователя (UI/UX)",
  };
  const front = {
    ...emptyRawTask(),
    id: "102",
    boardId: "783",
    title: "4.1 Экран пользователя (front)",
    tags: ["front"],
  };
  assert.equal(requiresExistingMockupLink(front, config, [design, front]), true);
});

test("requiresExistingMockupLink: функциональная (front) без пары UI/UX — false", () => {
  const task = {
    ...emptyRawTask(),
    id: "200",
    boardId: "783",
    title: "5.2 Система чатов (front)",
    tags: ["front", "доработка"],
    category: "Frontend",
  };
  assert.equal(requiresExistingMockupLink(task, config, [task]), false);
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
  assert.match(r.reason, /Макет не требуется/i);
});

test("ui_has_mockup_link: функциональная (front) без пары UI/UX → NOT_APPLICABLE", async () => {
  const task = {
    ...emptyRawTask(),
    boardId: "783",
    title: "5.2 Логика чатов (front)",
    tags: ["front", "доработка"],
    category: "Frontend",
  };
  const r = await uiHasMockupLinkRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
  assert.match(r.reason, /без пары \(UI\/UX\)/i);
});

test("ui_has_mockup_link: 4.1 (front) с парой UI/UX, только ТЗ → FAIL", async () => {
  const design = {
    ...emptyRawTask(),
    id: "101",
    boardId: "783",
    title: "4.1 Экран пользователя (UI/UX)",
  };
  const front = {
    ...emptyRawTask(),
    id: "102",
    boardId: "783",
    title: "4.1 Экран пользователя (front)",
    tags: ["front"],
    descriptionText: "ТЗ https://docs.google.com/document/d/tz/edit",
  };
  const r = await uiHasMockupLinkRule.evaluate(front, {
    config,
    allTasks: [design, front],
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /ТЗ не заменяет макет/i);
});

test("ui_has_mockup_link: 4.1 (front) с парой UI/UX и Figma → PASS", async () => {
  const design = {
    ...emptyRawTask(),
    id: "101",
    boardId: "783",
    title: "4.1 Экран пользователя (UI/UX)",
  };
  const front = {
    ...emptyRawTask(),
    id: "102",
    boardId: "783",
    title: "4.1 Экран пользователя (front)",
    links: ["https://www.figma.com/file/abc/screen"],
  };
  const r = await uiHasMockupLinkRule.evaluate(front, {
    config,
    allTasks: [design, front],
  });
  assert.equal(r.status, "PASS");
});

test("ui_has_mockup_link: 4.1 (front) Figma только в парной UI/UX → PASS", async () => {
  const design = {
    ...emptyRawTask(),
    id: "101",
    boardId: "783",
    title: "4.1 Экран пользователя (UI/UX)",
    links: ["https://www.figma.com/file/abc/screen"],
  };
  const front = {
    ...emptyRawTask(),
    id: "102",
    boardId: "783",
    title: "4.1 Экран пользователя (front)",
    tags: ["front"],
    descriptionText: "ТЗ https://docs.google.com/document/d/tz/edit",
  };
  const r = await uiHasMockupLinkRule.evaluate(front, {
    config,
    allTasks: [design, front],
  });
  assert.equal(r.status, "PASS");
  assert.match(r.reason, /парной задаче/i);
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

test("ui_mockup_approved: Заказчик согласовал в комментарии → PASS", async () => {
  const task = {
    ...emptyRawTask(),
    id: "17",
    boardId: "783",
    title: "3.2.2 UI: меню (UI/UX)",
    category: "UI/UX",
    comments: [{ text: "Заказчик согласовал", creatorName: "PM" }],
  };
  const r = await uiMockupApprovedRule.evaluate(task, { config, allTasks: [task] });
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

test("ui_mockup_approved: функциональная (front) без пары → NOT_APPLICABLE", async () => {
  const task = {
    ...emptyRawTask(),
    boardId: "783",
    title: "5.2 Логика чатов (front)",
    tags: ["front", "доработка"],
  };
  const r = await uiMockupApprovedRule.evaluate(task, { config, allTasks: [task] });
  assert.equal(r.status, "NOT_APPLICABLE");
  assert.match(r.reason, /без пары \(UI\/UX\)/i);
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
