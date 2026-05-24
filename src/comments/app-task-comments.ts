import type { Page } from "@playwright/test";
import type { TaskComment } from "../adapters/apptask/types.js";
import { createLogger } from "../adapters/apptask/logger.js";
import { getAppTaskApiBase } from "../collectors/app-task-api-client.js";

const log = createLogger("comments:api");

const GET_TASK_COMMENTS_PATH = "/board/get_task_comments";

export type AppTaskComment = {
  id: number | string;
  creatorId: number | string | null;
  content: string;
  createTime: string | null;
  parentId: number | string | null;
  attachmentList: unknown[];
};

type GetTaskCommentsPayload = {
  result?: number;
  data?: { id?: number; commentList?: unknown[] };
};

let resolvedApiUrl: string | null = null;

export function getTaskCommentsApiUrl(): string {
  return resolvedApiUrl ?? `${getAppTaskApiBase()}${GET_TASK_COMMENTS_PATH}`;
}

/** Запомнить host из перехваченного браузерного запроса (если отличается от default). */
export function setTaskCommentsApiUrlFromNetwork(url: string): void {
  if (!/\/board\/get_task_comments/i.test(url)) return;
  resolvedApiUrl = url.split("?")[0]!;
  log.info(`comments API url: ${resolvedApiUrl}`);
}

export function attachCommentsApiDiscovery(page: Page): () => void {
  const handler = (request: { url: () => string; method: () => string }) => {
    const url = request.url();
    if (
      request.method() === "POST" &&
      /\/board\/get_task_comments/i.test(url)
    ) {
      setTaskCommentsApiUrlFromNetwork(url);
    }
  };
  page.on("request", handler);
  return () => page.off("request", handler);
}

export function htmlCommentContentToText(
  html: string | null | undefined,
): string {
  if (!html?.trim()) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function mapRawComment(raw: unknown): AppTaskComment | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = row.id;
  if (id === undefined || id === null) return null;
  const content = typeof row.content === "string" ? row.content : "";
  return {
    id: typeof id === "number" ? id : String(id),
    creatorId:
      row.creatorId === undefined || row.creatorId === null
        ? null
        : typeof row.creatorId === "number"
          ? row.creatorId
          : String(row.creatorId),
    content,
    createTime:
      typeof row.createTime === "string" ? row.createTime : null,
    parentId:
      row.parentId === undefined || row.parentId === null
        ? null
        : typeof row.parentId === "number"
          ? row.parentId
          : String(row.parentId),
    attachmentList: Array.isArray(row.attachmentList)
      ? row.attachmentList
      : [],
  };
}

function parseCommentList(json: unknown): AppTaskComment[] {
  const payload = json as GetTaskCommentsPayload;
  const list = payload?.data?.commentList;
  if (!Array.isArray(list)) return [];
  return list.map(mapRawComment).filter((c): c is AppTaskComment => c !== null);
}

function buildRequestBody(
  taskId: number | string,
  boardId?: number,
): Record<string, unknown> {
  const id = typeof taskId === "string" ? Number(taskId) : taskId;
  if (boardId != null && Number.isFinite(boardId)) {
    return { boardId, id };
  }
  return { id };
}

/**
 * POST /board/get_task_comments без открытия модалки карточки.
 * Требует авторизованную сессию (board уже открыт на page).
 */
export async function loadTaskComments(
  page: Page,
  taskId: number | string,
  boardId?: number,
): Promise<AppTaskComment[]> {
  const id = typeof taskId === "string" ? Number(taskId) : taskId;
  if (!Number.isFinite(id)) return [];

  const url = getTaskCommentsApiUrl();
  try {
    const origin = new URL(url).origin;
    const cookies = await page.context().cookies(origin);
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cookie) headers.Cookie = cookie;

    const response = await page.request.post(url, {
      data: buildRequestBody(id, boardId),
      headers,
    });
    if (!response.ok()) {
      log.info(`get_task_comments task=${id} HTTP ${response.status()}`);
      return [];
    }
    const json = await response.json().catch(() => null);
    return parseCommentList(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.info(`get_task_comments task=${id} error: ${message}`);
    return [];
  }
}

export function appTaskCommentsToTaskComments(
  comments: AppTaskComment[],
): TaskComment[] {
  return comments.map((c) => ({
    text: htmlCommentContentToText(c.content),
    content: c.content,
    id: c.id,
    creatorId: c.creatorId,
    createTime: c.createTime,
    parentId: c.parentId,
  }));
}
