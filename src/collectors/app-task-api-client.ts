import type { Page } from "@playwright/test";
import { createLogger } from "../adapters/apptask/logger.js";
import type { AppTaskUser } from "../users/app-task-users.js";

const log = createLogger("api:client");

const DEFAULT_API_BASE =
  process.env.APPTASK_API_BASE?.replace(/\/$/, "") ??
  "https://host2201.apptask.ru";

let resolvedApiBase: string | null = null;

type ApiPayload = {
  result?: number;
  data?: unknown;
};

export type BoardState = {
  id: number;
  name: string;
};

export type BoardBlock = {
  id: number;
  name: string;
};

export type BoardSprint = {
  id: number;
  name: string;
};

export type ApiTaskListItem = {
  id: number;
  name: string;
  priority?: number;
  stateId?: number;
  boardId?: number;
  creatorId?: number;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  endTime?: string | null;
  createTime?: string | null;
  userList?: Array<{ userId?: number; userName?: string; realName?: string }>;
  tagList?: Array<{ tagId?: number; name?: string }>;
  plannedEndTimeOffset?: number;
  currentEndTimeOffset?: number;
};

export type ApiTaskDetails = {
  id: number;
  name?: string;
  content?: string | null;
  stateId?: number;
  blockId?: number;
  creatorId?: number;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  attachmentList?: Array<{ name?: string; fileUrl?: string; url?: string }>;
  tagList?: Array<{ tagId?: number; name?: string }>;
  userList?: Array<{ userId?: number; userName?: string; realName?: string }>;
};

export function getAppTaskApiBase(): string {
  return resolvedApiBase ?? DEFAULT_API_BASE;
}

export function setAppTaskApiBaseFromUrl(url: string): void {
  try {
    const origin = new URL(url).origin;
    if (origin.includes("apptask.ru") && resolvedApiBase !== origin) {
      resolvedApiBase = origin;
      log.info(`API base: ${resolvedApiBase}`);
    }
  } catch {
    // ignore
  }
}

export function attachApiBaseDiscovery(page: Page): () => void {
  const handler = (request: { url: () => string; method: () => string }) => {
    const url = request.url();
    if (request.method() !== "POST") return;
    if (!/apptask\.ru/i.test(url)) return;
    if (/\/board\//i.test(url) || /host\d+\.apptask/i.test(url)) {
      setAppTaskApiBaseFromUrl(url);
    }
  };
  page.on("request", handler);
  return () => page.off("request", handler);
}

function apiUrl(path: string): string {
  const base = getAppTaskApiBase().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function buildApiHeaders(
  page: Page,
  requestUrl: string,
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  return (async () => {
    const origin = new URL(requestUrl).origin;
    const cookies = await page.context().cookies(origin);
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(extra ?? {}),
    };
    if (cookie) headers.cookie = cookie;
    delete headers.host;
    delete headers["content-length"];
    return headers;
  })();
}

export async function postAppTaskApi<T = unknown>(
  page: Page,
  path: string,
  body: unknown,
  replayHeaders?: Record<string, string>,
): Promise<T | null> {
  const url = apiUrl(path);
  try {
    const headers = await buildApiHeaders(page, url, replayHeaders);

    const response = await page.request.post(url, {
      data: body,
      headers,
    });
    if (!response.ok()) {
      log.info(`POST ${path} HTTP ${response.status()}`);
      return null;
    }
    const json = (await response.json().catch(() => null)) as ApiPayload | null;
    if (!json || json.result !== 1) {
      log.info(`POST ${path} bad result: ${JSON.stringify(json)?.slice(0, 200)}`);
      return null;
    }
    return json.data as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.info(`POST ${path} error: ${message}`);
    return null;
  }
}

export async function getBoardSprints(
  page: Page,
  boardId: number,
  replayHeaders?: Record<string, string>,
): Promise<BoardSprint[]> {
  const data = await postAppTaskApi<BoardSprint[]>(
    page,
    "/board/get_sprints",
    boardId,
    replayHeaders,
  );
  return Array.isArray(data) ? data : [];
}

export async function getBoardStates(
  page: Page,
  boardId: number,
  sprintId: number,
  replayHeaders?: Record<string, string>,
): Promise<BoardState[]> {
  const data = await postAppTaskApi<BoardState[]>(
    page,
    "/board/get_states",
    {
    Id: sprintId,
    BoardId: boardId,
  },
    replayHeaders,
  );
  return Array.isArray(data) ? data : [];
}

export async function getBoardBlocks(
  page: Page,
  boardId: number,
  sprintId: number,
  replayHeaders?: Record<string, string>,
): Promise<BoardBlock[]> {
  const data = await postAppTaskApi<BoardBlock[]>(
    page,
    "/board/get_blocks",
    {
    BoardId: boardId,
    SprintId: sprintId,
  },
    replayHeaders,
  );
  return Array.isArray(data) ? data : [];
}

export async function getBoardTasks(
  page: Page,
  boardId: number,
  blockId: number,
  sprintId: number,
  replayHeaders?: Record<string, string>,
): Promise<ApiTaskListItem[]> {
  const data = await postAppTaskApi<ApiTaskListItem[]>(
    page,
    "/board/get_tasks",
    {
    boardId,
    blockId,
    sprintId,
  },
    replayHeaders,
  );
  return Array.isArray(data) ? data : [];
}

export async function getTaskDetails(
  page: Page,
  boardId: number,
  taskId: number | string,
  replayHeaders?: Record<string, string>,
): Promise<ApiTaskDetails | null> {
  const id = typeof taskId === "string" ? Number(taskId) : taskId;
  if (!Number.isFinite(id)) return null;
  const data = await postAppTaskApi<ApiTaskDetails>(
    page,
    "/board/get_task_details",
    { boardId, id },
    replayHeaders,
  );
  return data && typeof data === "object" ? data : null;
}

export async function getUsersViaApi(page: Page): Promise<AppTaskUser[]> {
  const usersBase =
    process.env.APPTASK_USERS_API_BASE?.replace(/\/$/, "") ??
    "https://apptask.ru";
  const url = `${usersBase}/panel/profile/get_users`;
  try {
    const headers = await buildApiHeaders(page, url);

    const response = await page.request.post(url, {
      data: {},
      headers,
    });
    if (!response.ok()) return [];
    const json = (await response.json().catch(() => null)) as {
      result?: number;
      data?: unknown[];
    };
    if (!json?.data || !Array.isArray(json.data)) return [];
    const users: AppTaskUser[] = [];
    for (const row of json.data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const id = r.id;
      const realName =
        typeof r.realName === "string" ? r.realName.trim() : "";
      if (id == null || !realName) continue;
      users.push({
        id: typeof id === "number" ? id : String(id),
        realName,
        email: typeof r.email === "string" ? r.email : null,
        blocked: r.blocked === true,
        roleUser:
          typeof r.roleUser === "string"
            ? r.roleUser
            : typeof r.role === "string"
              ? r.role
              : null,
        role: typeof r.role === "string" ? r.role : null,
      });
    }
    return users;
  } catch {
    return [];
  }
}
