import type { Page } from "@playwright/test";
import type { TaskComment } from "../adapters/apptask/types.js";
import { createLogger } from "../adapters/apptask/logger.js";
import {
  buildApptaskApiHeaders,
  getAppTaskApiBase,
  postAppTaskApi,
} from "../collectors/app-task-api-client.js";

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

type CommentsApiData = {
  id?: number;
  commentList?: unknown[];
};

export type LoadTaskCommentsOptions = {
  /** Заголовки из перехвата board API (attachBoardApiSniffer) + get_task_comments. */
  replayHeaders?: Record<string, string>;
};

let resolvedApiUrl: string | null = null;
const commentsReplayHeaders: Record<string, string> = {};

function rememberCommentsRequestHeaders(headers: Record<string, string>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (value) commentsReplayHeaders[key.toLowerCase()] = value;
  }
}

export function getCommentsReplayHeaders(): Record<string, string> {
  return { ...commentsReplayHeaders };
}

export function mergeCommentsReplayHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, value] of Object.entries(src)) {
      if (value) merged[key.toLowerCase()] = value;
    }
  }
  return merged;
}

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
  const handler = (request: {
    url: () => string;
    method: () => string;
    headers: () => Record<string, string>;
  }) => {
    const url = request.url();
    if (
      request.method() === "POST" &&
      /\/board\/get_task_comments/i.test(url)
    ) {
      setTaskCommentsApiUrlFromNetwork(url);
      rememberCommentsRequestHeaders(request.headers());
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
async function loadTaskCommentsViaBrowser(
  page: Page,
  url: string,
  body: Record<string, unknown>,
  replayHeaders?: Record<string, string>,
): Promise<AppTaskComment[] | null> {
  const extraHeaders = { ...(replayHeaders ?? {}) };
  delete extraHeaders.host;
  delete extraHeaders["content-length"];

  const result = await page
    .evaluate(
      async ({ requestUrl, requestBody, extraHeaders: hdrs }) => {
        const res = await fetch(requestUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...hdrs,
          },
          body: JSON.stringify(requestBody),
        });
        if (!res.ok) {
          return { ok: false as const, status: res.status, json: null };
        }
        return { ok: true as const, status: res.status, json: await res.json() };
      },
      { requestUrl: url, requestBody: body, extraHeaders },
    )
    .catch(() => null);

  if (!result?.ok) return null;
  return parseCommentList(result.json);
}

async function loadTaskCommentsViaPostAppTaskApi(
  page: Page,
  body: Record<string, unknown>,
  replayHeaders?: Record<string, string>,
): Promise<AppTaskComment[] | null> {
  const data = await postAppTaskApi<CommentsApiData>(
    page,
    GET_TASK_COMMENTS_PATH,
    body,
    replayHeaders,
  );
  if (!data) return null;
  return parseCommentList({ data });
}

/**
 * POST /board/get_task_comments без открытия модалки карточки.
 * replayHeaders — из attachBoardApiSniffer после openBoard (как у API collector).
 */
export async function loadTaskComments(
  page: Page,
  taskId: number | string,
  boardId?: number,
  options: LoadTaskCommentsOptions = {},
): Promise<AppTaskComment[]> {
  const id = typeof taskId === "string" ? Number(taskId) : taskId;
  if (!Number.isFinite(id)) return [];

  const url = getTaskCommentsApiUrl();
  const body = buildRequestBody(id, boardId);
  const replayHeaders = options.replayHeaders;

  try {
    const viaSharedApi = await loadTaskCommentsViaPostAppTaskApi(
      page,
      body,
      replayHeaders,
    );
    if (viaSharedApi !== null) {
      return viaSharedApi;
    }

    const headers = await buildApptaskApiHeaders(page, url, replayHeaders);
    const response = await page.request.post(url, {
      data: body,
      headers,
    });
    if (response.ok()) {
      const json = await response.json().catch(() => null);
      const parsed = parseCommentList(json);
      if (parsed.length > 0) return parsed;
      const payload = json as GetTaskCommentsPayload;
      if (payload?.result === 1 && Array.isArray(payload?.data?.commentList)) {
        return parsed;
      }
    } else {
      log.info(
        `get_task_comments task=${id} boardId=${boardId ?? "?"} HTTP ${response.status()}, retry via browser fetch`,
      );
    }

    const viaBrowser = await loadTaskCommentsViaBrowser(
      page,
      url,
      body,
      headers,
    );
    if (viaBrowser != null) {
      if (viaBrowser.length > 0 || response.ok()) {
        log.info(
          `get_task_comments task=${id} boardId=${boardId ?? "?"} via browser: ${viaBrowser.length} comments`,
        );
      }
      return viaBrowser;
    }

    if (!response.ok()) {
      log.info(
        `get_task_comments task=${id} boardId=${boardId ?? "?"} HTTP ${response.status()}`,
      );
    }
    return [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.info(
      `get_task_comments task=${id} boardId=${boardId ?? "?"} error: ${message}`,
    );
    const headers = await buildApptaskApiHeaders(page, url, replayHeaders);
    const viaBrowser = await loadTaskCommentsViaBrowser(
      page,
      url,
      body,
      headers,
    ).catch(() => null);
    return viaBrowser ?? [];
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
