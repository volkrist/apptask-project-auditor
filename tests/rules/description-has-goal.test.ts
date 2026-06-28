import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { descriptionIndicatesGoal } from "../../src/rules/hard/description-goal-text.js";
import { descriptionHasGoalRule } from "../../src/rules/hard/description-has-goal.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";

const config = loadAuditConfig();

const TASK_96_DESCRIPTION =
  "Реализовать фронтенд-часть страницы «Профиль пользователя». Компонент должен включать в себя отображение персональных данных (аватар, ФИО, контакты, роль в системе), форму их редактирования с валидацией полей, а также вкладку со сменой пароля и настройками уведомлений. Необходимо интегрировать готовые UI-компоненты с существующими эндпоинтами бэкенда API, обработать состояния загрузки (лоадеры) и возможные ошибки сети.";

test("descriptionIndicatesGoal: секция «Цель:»", () => {
  assert.equal(descriptionIndicatesGoal("Цель: собрать отчёт.", config.goalKeywords), true);
});

test("descriptionIndicatesGoal: секция «Результат —»", () => {
  assert.equal(
    descriptionIndicatesGoal("Результат — страница в проде без ошибок.", config.goalKeywords),
    true,
  );
});

test("descriptionIndicatesGoal: TurboWeave #96 — «необходимо» и «должен включать»", () => {
  assert.equal(descriptionIndicatesGoal(TASK_96_DESCRIPTION, config.goalKeywords), true);
});

test("descriptionHasGoalRule: TurboWeave #96 → PASS", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText: TASK_96_DESCRIPTION,
  };
  const result = descriptionHasGoalRule.evaluate(task, {
    config,
    allTasks: [task],
  });
  assert.equal(result.status, "PASS");
});

test("descriptionIndicatesGoal: только ссылки без маркеров → false", () => {
  assert.equal(
    descriptionIndicatesGoal(
      "Ссылка на ТЗ https://docs.google.com/document/d/abc/edit",
      config.goalKeywords,
    ),
    false,
  );
});
