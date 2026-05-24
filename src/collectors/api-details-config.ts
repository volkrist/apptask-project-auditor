import type { RawTask } from "../adapters/apptask/types.js";
import { isBlank, parseRuDate, startOfDay } from "../rules/helpers.js";
import {
  isDueDateOverdue,
  isInProgressTask,
  isOnReviewTask,
} from "../comments/comments-audit-config.js";
import type { ApiDetailsMode } from "./collector-config.js";

/** Задача-кандидат для get_task_details (режим candidates). */
export function shouldLoadDetailsForTask(
  task: RawTask,
  mode: ApiDetailsMode,
): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  if (isBlank(task.descriptionText)) return true;
  if (isInProgressTask(task)) return true;
  if (isBlank(task.dueDate)) return true;
  if (isDueDateOverdue(task)) return true;
  if (isOnReviewTask(task)) return true;
  if (task.links.length === 0 && task.attachments.length === 0) return true;
  return false;
}

export function filterTasksForDetailsLoad(
  tasks: RawTask[],
  mode: ApiDetailsMode,
): RawTask[] {
  if (mode === "off") return [];
  const withId = tasks.filter((t) => t.id?.trim());
  if (mode === "all") return withId;
  return withId.filter((t) => shouldLoadDetailsForTask(t, "candidates"));
}
