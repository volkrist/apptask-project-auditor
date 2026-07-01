import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAuditConfig } from "../../src/config/audit-config.js";
import { descriptionIndicatesGoal } from "../../src/rules/hard/description-goal-text.js";
import { descriptionHasGoalRule } from "../../src/rules/hard/description-has-goal.js";
import { emptyRawTask } from "../../src/adapters/apptask/types.js";

const config = loadAuditConfig();

const TASK_96_DESCRIPTION =
  "Реализовать фронтенд-часть страницы «Профиль пользователя». Компонент должен включать в себя отображение персональных данных (аватар, ФИО, контакты, роль в системе), форму их редактирования с валидацией полей, а также вкладку со сменой пароля и настройками уведомлений. Необходимо интегрировать готовые UI-компоненты с существующими эндпоинтами бэкенда API, обработать состояния загрузки (лоадеры) и возможные ошибки сети.";

test("descriptionIndicatesGoal: заголовок «Цель» в начале", () => {
  assert.equal(descriptionIndicatesGoal("Цель: собрать отчёт."), true);
  assert.equal(descriptionIndicatesGoal("Цель собрать отчёт по найму."), true);
});

test("descriptionIndicatesGoal: фраза «ожидаемый результат»", () => {
  assert.equal(
    descriptionIndicatesGoal("Ожидаемый результат: форма сохраняет данные."),
    true,
  );
  assert.equal(
    descriptionIndicatesGoal("Ожидаемый результат — страница в проде без ошибок."),
    true,
  );
});

test("descriptionIndicatesGoal: фраза «цель задачи»", () => {
  assert.equal(
    descriptionIndicatesGoal("Цель задачи — реализовать страницу профиля."),
    true,
  );
});

test("descriptionIndicatesGoal: только «Результат» без «ожидаемый» → false", () => {
  assert.equal(
    descriptionIndicatesGoal("Результат — страница в проде без ошибок."),
    false,
  );
});

test("descriptionIndicatesGoal: TurboWeave #96 без цели/результата → false", () => {
  assert.equal(descriptionIndicatesGoal(TASK_96_DESCRIPTION), false);
});

test("descriptionHasGoalRule: TurboWeave #96 → FAIL", () => {
  const task = {
    ...emptyRawTask(),
    descriptionText: TASK_96_DESCRIPTION,
  };
  const result = descriptionHasGoalRule.evaluate(task, {
    config,
    allTasks: [task],
  });
  assert.equal(result.status, "FAIL");
});

test("descriptionIndicatesGoal: общие слова без цели/результата → false", () => {
  assert.equal(
    descriptionIndicatesGoal(
      "Необходимо сделать форму. Компонент должен включать валидацию.",
    ),
    false,
  );
});

test("descriptionIndicatesGoal: только ссылка на ТЗ → false", () => {
  assert.equal(
    descriptionIndicatesGoal(
      "Ссылка на ТЗ https://docs.google.com/document/d/abc/edit",
    ),
    false,
  );
});
