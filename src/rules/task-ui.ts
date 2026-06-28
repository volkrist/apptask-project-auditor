import type { RawTask } from "../adapters/apptask/types.js";
import type { AuditConfig } from "../config/audit-config.js";
import { extractTaskType } from "./helpers.js";

const CYR_WORD = "[а-яё]*";
const UI_TITLE_RE =
  new RegExp(
    `(^|\\s)(ui|ux|интерфейс|верстк${CYR_WORD}|frontend|front-end|макет${CYR_WORD}|дизайн${CYR_WORD}|layout)(\\s|:|$)`,
    "i",
  );
const UI_SUFFIX_RE = /\(ui\/ux\)|\(ui\)|\(ux\)/i;
const UI_TYPE_RE = /ui|front|дизайн|верст/i;

/** Задачи, к которым применяются правила про макеты/адаптив. */
export function isUiRelatedTask(task: RawTask): boolean {
  const title = task.title ?? "";
  if (UI_SUFFIX_RE.test(title)) return true;
  if (UI_TITLE_RE.test(title)) return true;
  const type = task.stage ?? task.category ?? "";
  if (type && UI_TYPE_RE.test(type)) return true;
  const tags = task.tags ?? [];
  return tags.some((t) => UI_TYPE_RE.test(t));
}

const MOCKUP_CREATION_TITLE_RE =
  /(созда(ть|ние)|разработ(ать|ка)|отрис(овать|овка)|подготов(ить|ка)).{0,40}макет|макет.{0,30}(figma|в\s+figma)|прототип|wireframe|вайрфрейм|дизайн[-\s](концеп|экран|страниц|интерфейс|меню|hud|ui)|^[\d.]+\s+ui:\s*дизайн/i;

/** Задача, где результатом является макет/дизайн, а не вёрстка по готовому макету. */
export function isMockupCreationTask(task: RawTask, config: AuditConfig): boolean {
  if (extractTaskType(task, config) === "дизайн") return true;
  const tags = task.tags ?? [];
  if (tags.some((t) => /^дизайн$/i.test(t.trim()))) return true;
  const title = task.title ?? "";
  if (MOCKUP_CREATION_TITLE_RE.test(title)) return true;
  return false;
}

const IMPLEMENT_FROM_EXISTING_MOCKUP_RE =
  /верстк.{0,30}по\s+макету|по\s+готовому\s+макету|сверстать\s+по\s+макету|implement.{0,30}mockup/i;

/** UI/front-задача на вёрстку/реализацию — нужна ссылка на готовый макет. */
export function requiresExistingMockupLink(
  task: RawTask,
  config: AuditConfig,
): boolean {
  if (!isUiRelatedTask(task)) return false;
  if (isMockupCreationTask(task, config)) return false;

  const title = task.title ?? "";
  const blob = [title, task.descriptionText ?? ""].join("\n");

  if (IMPLEMENT_FROM_EXISTING_MOCKUP_RE.test(blob)) return true;

  // TurboWeave и аналоги: «3.2.1 UI: … (UI/UX)» — макет создаётся в задаче.
  if (UI_SUFFIX_RE.test(title) || /^[\d.]+\s+ui:/i.test(title)) {
    return false;
  }

  return true;
}
