import type { RawTask } from "../adapters/apptask/types.js";

const UI_TITLE_RE =
  /(^|\s)(ui|ux|интерфейс|верстк|frontend|front-end|макет|дизайн|layout)(\s|:|$)/i;
const UI_TYPE_RE = /ui|front|дизайн|верст/i;

/** Задачи, к которым применяются правила про макеты/адаптив. */
export function isUiRelatedTask(task: RawTask): boolean {
  const title = task.title ?? "";
  if (UI_TITLE_RE.test(title)) return true;
  const type = task.stage ?? task.category ?? "";
  if (type && UI_TYPE_RE.test(type)) return true;
  const tags = task.tags ?? [];
  return tags.some((t) => UI_TYPE_RE.test(t));
}
