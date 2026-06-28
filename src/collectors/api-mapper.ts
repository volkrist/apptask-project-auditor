import type {
  RawTask,
  TaskAssigneeRef,
  TaskComment,
} from "../adapters/apptask/types.js";
import { emptyRawTask } from "../adapters/apptask/types.js";
import {
  appTaskCommentsToTaskComments,
  htmlCommentContentToText,
} from "../comments/app-task-comments.js";
import type { AppTaskComment } from "../comments/app-task-comments.js";
import type { AppTaskUser } from "../users/app-task-users.js";
import type {
  ApiTaskDetails,
  ApiTaskListItem,
  BoardBlock,
  BoardState,
} from "./app-task-api-client.js";

export function formatIsoToRuDate(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function formatSecondsToTime(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0) return `${h} ч`;
  if (m > 0) return `${m} мин`;
  return null;
}

export function extractLinksFromHtml(html: string | null | undefined): string[] {
  if (!html?.trim()) return [];
  const links = new Set<string>();
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1]?.trim();
    if (href && /^https?:\/\//i.test(href)) links.add(href);
  }
  const plainRe = /https?:\/\/[^\s<>"']+/gi;
  while ((m = plainRe.exec(html)) !== null) {
    links.add(m[0]!.replace(/[.,;:!?)]+$/, ""));
  }
  return [...links];
}

export function htmlToPlainText(html: string | null | undefined): string {
  return htmlCommentContentToText(html);
}

function resolveUserName(
  userId: number | string | null | undefined,
  usersById: Map<string, AppTaskUser>,
): string | null {
  if (userId == null) return null;
  const key = String(userId);
  return usersById.get(key)?.realName ?? null;
}

function stateName(
  stateId: number | undefined,
  statesById: Map<number, BoardState>,
): string | null {
  if (stateId == null) return null;
  return statesById.get(stateId)?.name ?? null;
}

function blockName(
  blockId: number | undefined,
  blocksById: Map<number, BoardBlock>,
): string | null {
  if (blockId == null) return null;
  return blocksById.get(blockId)?.name ?? null;
}

export function mapUserListToAssignees(
  userList: ApiTaskListItem["userList"] | undefined,
  usersById: Map<string, AppTaskUser>,
): { assignees: string[]; assigneeRefs: TaskAssigneeRef[] } {
  const assignees: string[] = [];
  const assigneeRefs: TaskAssigneeRef[] = [];
  if (!Array.isArray(userList)) return { assignees, assigneeRefs };

  for (const row of userList) {
    const userId =
      row.userId != null ? String(row.userId) : null;
    const fromApi =
      typeof row.realName === "string"
        ? row.realName.trim()
        : typeof row.userName === "string"
          ? row.userName.trim()
          : "";
    const fromMap = userId ? usersById.get(userId)?.realName : null;
    const name = fromApi || fromMap || "";
    if (!name) continue;
    assignees.push(name);
    assigneeRefs.push({ name, userId });
  }
  return { assignees, assigneeRefs };
}

export function mapTagList(
  tagList: ApiTaskListItem["tagList"] | undefined,
): string[] {
  if (!Array.isArray(tagList)) return [];
  return tagList
    .map((t) => {
      if (typeof t.name === "string" && t.name.trim()) return t.name.trim();
      if (t.tagId != null) return `tag:${t.tagId}`;
      return null;
    })
    .filter((x): x is string => Boolean(x));
}

export type MapTaskListOptions = {
  boardUrl: string;
  boardId: number;
  blockId: number;
  statesById: Map<number, BoardState>;
  blocksById: Map<number, BoardBlock>;
  usersById: Map<string, AppTaskUser>;
};

export function mapApiTaskListItemToRawTask(
  item: ApiTaskListItem,
  opts: MapTaskListOptions,
): RawTask {
  const base = emptyRawTask();
  const id = item.id != null ? String(item.id) : null;
  const status = stateName(item.stateId, opts.statesById);
  const { assignees, assigneeRefs } = mapUserListToAssignees(
    item.userList,
    opts.usersById,
  );
  const creator =
    item.creatorId != null
      ? resolveUserName(item.creatorId, opts.usersById)
      : null;

  return {
    ...base,
    id,
    url: id ? `${opts.boardUrl.replace(/\/$/, "")}/${id}` : null,
    title: typeof item.name === "string" ? item.name.trim() : null,
    status,
    stage: null,
    startDate: formatIsoToRuDate(item.plannedStartTime),
    dueDate: formatIsoToRuDate(item.plannedEndTime ?? item.endTime),
    priority:
      item.priority != null && Number.isFinite(item.priority)
        ? String(item.priority)
        : null,
    tags: mapTagList(item.tagList),
    creator,
    assignees,
    assigneeRefs,
    category: blockName(opts.blockId, opts.blocksById),
    plannedTime: formatSecondsToTime(item.plannedEndTimeOffset),
    actualTime: formatSecondsToTime(item.currentEndTimeOffset),
    createdAt: formatIsoToRuDate(item.createTime),
  };
}

export function mergeTaskDetailsIntoRawTask(
  task: RawTask,
  details: ApiTaskDetails,
  opts: {
    statesById: Map<number, BoardState>;
    blocksById: Map<number, BoardBlock>;
    usersById: Map<string, AppTaskUser>;
  },
): RawTask {
  const content = typeof details.content === "string" ? details.content : "";
  const descriptionText = htmlToPlainText(content);
  const links = extractLinksFromHtml(content);
  const status = stateName(details.stateId, opts.statesById) ?? task.status;
  const { assignees, assigneeRefs } = mapUserListToAssignees(
    details.userList ?? undefined,
    opts.usersById,
  );

  const attachments = Array.isArray(details.attachmentList)
    ? details.attachmentList
        .map((a) => {
          const name =
            typeof a.name === "string" ? a.name.trim() : "attachment";
          const url =
            typeof a.fileUrl === "string"
              ? a.fileUrl
              : typeof a.url === "string"
                ? a.url
                : null;
          return { name, url };
        })
        .filter((a) => a.name)
    : task.attachments;

  return {
    ...task,
    title:
      typeof details.name === "string" && details.name.trim()
        ? details.name.trim()
        : task.title,
    status,
    stage: task.stage,
    descriptionText: descriptionText || task.descriptionText,
    links: links.length > 0 ? links : task.links,
    attachments: attachments.length > 0 ? attachments : task.attachments,
    tags:
      details.tagList && details.tagList.length > 0
        ? mapTagList(details.tagList)
        : task.tags,
    assignees: assignees.length > 0 ? assignees : task.assignees,
    assigneeRefs:
      assigneeRefs.length > 0 ? assigneeRefs : task.assigneeRefs,
    category:
      blockName(details.blockId, opts.blocksById) ?? task.category,
    creator:
      details.creatorId != null
        ? resolveUserName(details.creatorId, opts.usersById) ?? task.creator
        : task.creator,
    startDate:
      formatIsoToRuDate(details.plannedStartTime) ?? task.startDate,
    dueDate:
      formatIsoToRuDate(details.plannedEndTime) ?? task.dueDate,
  };
}

export function appTaskCommentsToRawComments(
  comments: AppTaskComment[],
): TaskComment[] {
  return appTaskCommentsToTaskComments(comments);
}

export function buildUsersMap(users: AppTaskUser[]): Map<string, AppTaskUser> {
  const map = new Map<string, AppTaskUser>();
  for (const u of users) {
    map.set(String(u.id), u);
  }
  return map;
}

export function buildStatesMap(states: BoardState[]): Map<number, BoardState> {
  return new Map(states.map((s) => [s.id, s]));
}

export function buildBlocksMap(blocks: BoardBlock[]): Map<number, BoardBlock> {
  return new Map(blocks.map((b) => [b.id, b]));
}
