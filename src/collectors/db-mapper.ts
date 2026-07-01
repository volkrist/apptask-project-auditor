import type { RawTask, TaskComment, TaskHistoryEntry } from "../adapters/apptask/types.js";
import { emptyRawTask } from "../adapters/apptask/types.js";
import { htmlToPlainText, formatIsoToRuDate, formatSecondsToTime, extractLinksFromHtml } from "./api-mapper.js";
import { buildTaskUrl } from "./db-config.js";
import type {
  DbAssigneeRow,
  DbCommentRow,
  DbHistoryRow,
  DbTagRow,
  DbTaskRow,
} from "./db-types.js";

export type DbCollectBundle = {
  tasks: DbTaskRow[];
  assignees: DbAssigneeRow[];
  tags: DbTagRow[];
  comments: DbCommentRow[];
  histories: DbHistoryRow[];
};

function taskKey(boardId: number, taskId: number): string {
  return `${boardId}:${taskId}`;
}

function toRuDate(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return formatIsoToRuDate(value.toISOString());
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) return s.slice(0, 10);
  return formatIsoToRuDate(s) ?? s.slice(0, 10);
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return s || null;
}

export function mapDbBundleToRawTasks(
  bundle: DbCollectBundle,
  appTaskBaseUrl: string,
): RawTask[] {
  const assigneesByTask = new Map<string, DbAssigneeRow[]>();
  for (const row of bundle.assignees) {
    const key = taskKey(row.board_id, row.task_id);
    const list = assigneesByTask.get(key) ?? [];
    list.push(row);
    assigneesByTask.set(key, list);
  }

  const tagsByTask = new Map<string, string[]>();
  for (const row of bundle.tags) {
    const key = taskKey(row.board_id, row.task_id);
    const list = tagsByTask.get(key) ?? [];
    if (row.tag_name?.trim()) list.push(row.tag_name.trim());
    tagsByTask.set(key, list);
  }

  const commentsByTask = new Map<string, TaskComment[]>();
  for (const row of bundle.comments) {
    const key = taskKey(row.board_id, row.task_id);
    const list = commentsByTask.get(key) ?? [];
    list.push({
      text: htmlToPlainText(row.content),
      content: row.content ?? undefined,
      id: row.id,
      creatorId: row.creator_id,
      creatorName: row.creator_name?.trim() || null,
      createTime: toIso(row.create_time),
      parentId: row.parent_id,
    });
    commentsByTask.set(key, list);
  }

  const historyByTask = new Map<string, TaskHistoryEntry[]>();
  for (const row of bundle.histories) {
    const key = taskKey(row.board_id, row.task_id);
    const list = historyByTask.get(key) ?? [];
    list.push({
      id: row.id,
      userId: row.user_id,
      userName: row.real_name,
      actionType: row.action_type,
      date: toIso(row.date),
      data: row.data,
    });
    historyByTask.set(key, list);
  }

  return bundle.tasks.map((t) => {
    const key = taskKey(t.board_id, t.id);
    const assigneeRows = assigneesByTask.get(key) ?? [];
    const assignees = assigneeRows
      .map((a) => a.real_name?.trim())
      .filter((n): n is string => Boolean(n));
    const assigneeRefs = assigneeRows.map((a) => ({
      name: a.real_name?.trim() || `user:${a.user_id}`,
      userId: String(a.user_id),
    }));
    const descriptionText = htmlToPlainText(t.content);
    const status = t.status_name?.trim() ?? null;

    const raw: RawTask = {
      ...emptyRawTask(),
      id: String(t.id),
      boardId: String(t.board_id),
      url: buildTaskUrl(appTaskBaseUrl, t.board_id, t.id),
      title: t.task_name?.trim() ?? null,
      descriptionText: descriptionText || null,
      createdAt: toRuDate(t.create_time),
      startDate: toRuDate(t.planned_start_time),
      dueDate: toRuDate(t.planned_end_time),
      endDate: toRuDate(t.end_time),
      updatedAt: toIso(t.update_time),
      priority: t.priority != null ? String(t.priority) : null,
      status,
      stage: t.sprint_name?.trim() ?? null,
      category: t.block_name?.trim() ?? null,
      plannedTime: formatSecondsToTime(t.planned_end_time_offset),
      actualTime: formatSecondsToTime(t.current_end_time_offset),
      links: extractLinksFromHtml(t.content),
      tags: tagsByTask.get(key) ?? [],
      assignees,
      assigneeRefs,
      comments: commentsByTask.get(key) ?? [],
      history: historyByTask.get(key) ?? [],
      sprintId: t.sprint_id != null ? String(t.sprint_id) : null,
      realSprintId: t.real_sprint_id != null ? String(t.real_sprint_id) : null,
    };
    return raw;
  });
}

export function filterRawTasksForBoard(
  tasks: RawTask[],
  boardId: number,
): RawTask[] {
  const id = String(boardId);
  return tasks.filter((t) => t.boardId === id);
}
