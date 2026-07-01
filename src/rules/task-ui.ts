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
const FRONT_SUFFIX_RE = /\(front\)|\(фронт\)/i;
const UI_TYPE_RE = /ui|front|дизайн|верст/i;

/** Задачи, к которым применяются правила про макеты/адаптив. */
export function isUiRelatedTask(task: RawTask): boolean {
  const title = task.title ?? "";
  if (UI_SUFFIX_RE.test(title)) return true;
  if (FRONT_SUFFIX_RE.test(title)) return true;
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
  if (hasUiUxTitleMarker(title)) return true;
  return false;
}

const IMPLEMENT_FROM_EXISTING_MOCKUP_RE =
  /верстк.{0,30}по\s+макету|по\s+готовому\s+макету|сверстать\s+по\s+макету|implement.{0,30}mockup/i;

/** Нумерация из TurboWeave: «4.1 Экран пользователя (front)». */
export function extractTaskNumberPrefix(title: string): string | null {
  const m = title.trim().match(/^(\d+(?:\.\d+)*)\b/);
  return m?.[1] ?? null;
}

export function hasUiUxTitleMarker(title: string): boolean {
  return UI_SUFFIX_RE.test(title);
}

export function hasFrontTitleMarker(title: string): boolean {
  return FRONT_SUFFIX_RE.test(title);
}

export function isFrontTagged(task: RawTask): boolean {
  return (task.tags ?? []).some((t) => /^front$/i.test(t.trim()));
}

/** Front-задача на вёрстку экрана (не дизайн). */
export function isFrontLayoutTask(task: RawTask): boolean {
  const title = task.title ?? "";
  return hasFrontTitleMarker(title) || isFrontTagged(task);
}

/**
 * На доске есть парная задача дизайнера с тем же номером и (UI/UX).
 * Пример: 4.1 … (UI/UX) + 4.1 … (front).
 */
export function findPairedUiUxTask(
  task: RawTask,
  allTasks: RawTask[],
): RawTask | undefined {
  const prefix = extractTaskNumberPrefix(task.title ?? "");
  if (!prefix) return undefined;
  const boardId = task.boardId;
  return allTasks.find((other) => {
    if (other.id === task.id && other.boardId === task.boardId) return false;
    if (boardId && other.boardId && other.boardId !== boardId) return false;
    if (extractTaskNumberPrefix(other.title ?? "") !== prefix) return false;
    return hasUiUxTitleMarker(other.title ?? "");
  });
}

export function hasPairedUiUxTask(
  task: RawTask,
  allTasks: RawTask[],
): boolean {
  return findPairedUiUxTask(task, allTasks) != null;
}

/** Текст и ссылки для поиска Figma: карточка + парная (UI/UX) с тем же номером. */
export function collectMockupLinkBlob(
  task: RawTask,
  allTasks: RawTask[] = [],
): string {
  const parts: string[] = [
    task.descriptionText ?? "",
    ...(task.links ?? []),
    ...(task.attachments ?? []).map((a) => a.url ?? a.name ?? ""),
  ];
  const paired = findPairedUiUxTask(task, allTasks);
  if (paired) {
    parts.push(
      paired.descriptionText ?? "",
      ...(paired.links ?? []),
      ...(paired.attachments ?? []).map((a) => a.url ?? a.name ?? ""),
    );
  }
  return parts.filter(Boolean).join("\n");
}

export function hasMockupLinkReference(textBlob: string): boolean {
  if (/figma\.com|zeplin\.com|sketch\.com|invisionapp\.com/i.test(textBlob)) {
    return true;
  }
  return /https?:\/\/\S*(mockup|макет)/i.test(textBlob);
}

/** Нужна проверка согласования макета (вёрстка или задача на создание UI). */
export function requiresMockupApprovalCheck(
  task: RawTask,
  config: AuditConfig,
  allTasks: RawTask[] = [],
): boolean {
  return (
    requiresExistingMockupLink(task, config, allTasks) ||
    isMockupCreationTask(task, config)
  );
}

/**
 * UI/front-задача на вёрстку по готовому макету — нужна ссылка на Figma.
 * Не применяется к функциональным front-задачам без пары (UI/UX) с тем же номером.
 */
export function requiresExistingMockupLink(
  task: RawTask,
  config: AuditConfig,
  allTasks: RawTask[] = [],
): boolean {
  if (!isUiRelatedTask(task)) return false;
  if (isMockupCreationTask(task, config)) return false;

  const title = task.title ?? "";
  const blob = [title, task.descriptionText ?? ""].join("\n");

  if (IMPLEMENT_FROM_EXISTING_MOCKUP_RE.test(blob)) return true;

  if (isFrontLayoutTask(task) && hasPairedUiUxTask(task, allTasks)) {
    return true;
  }

  return false;
}
