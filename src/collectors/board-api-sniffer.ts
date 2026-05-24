import type { Page } from "@playwright/test";
import type {
  ApiTaskListItem,
  BoardBlock,
  BoardState,
} from "./app-task-api-client.js";
import { setAppTaskApiBaseFromUrl } from "./app-task-api-client.js";

export type BoardApiSniffer = {
  sprintId: number | null;
  boardId: number | null;
  blockIds: Set<number>;
  states: BoardState[];
  blocks: BoardBlock[];
  /** Tasks captured from browser get_tasks responses during board load. */
  capturedTasks: Map<number, ApiTaskListItem[]>;
  /** Headers from a successful browser board API call (for page.request replay). */
  apiRequestHeaders: Record<string, string>;
  stop: () => void;
};

function parsePostJson(postData: string | null): Record<string, unknown> | null {
  if (!postData?.trim()) return null;
  try {
    return JSON.parse(postData) as Record<string, unknown>;
  } catch {
    const n = Number(postData);
    return Number.isFinite(n) ? { boardId: n } : null;
  }
}

export function attachBoardApiSniffer(page: Page): BoardApiSniffer {
  const blockIds = new Set<number>();
  const capturedTasks = new Map<number, ApiTaskListItem[]>();
  const states: BoardState[] = [];
  const blocks: BoardBlock[] = [];
  let sprintId: number | null = null;
  let boardId: number | null = null;
  const apiRequestHeaders: Record<string, string> = {};

  const onRequest = (request: {
    url: () => string;
    method: () => string;
    headers: () => Record<string, string>;
  }) => {
    const url = request.url();
    if (request.method() !== "POST") return;
    if (!/host\d+\.apptask\.ru\/board\//i.test(url)) return;
    const h = request.headers();
    for (const [key, value] of Object.entries(h)) {
      if (value) apiRequestHeaders[key.toLowerCase()] = value;
    }
  };

  const onResponse = async (response: {
    url: () => string;
    status: () => number;
    request: () => { method: () => string; postData: () => string | null };
    json: () => Promise<unknown>;
  }) => {
    const url = response.url();
    if (response.request().method() !== "POST") return;
    if (!/apptask\.ru/i.test(url)) return;

    setAppTaskApiBaseFromUrl(url);
    const post = parsePostJson(response.request().postData());

    if (/\/board\/get_states/i.test(url) && response.status() === 200) {
      if (post) {
        const sid = Number(post.Id ?? post.id);
        const bid = Number(post.BoardId ?? post.boardId);
        if (Number.isFinite(sid)) sprintId = sid;
        if (Number.isFinite(bid)) boardId = bid;
      }
      try {
        const json = (await response.json()) as { data?: BoardState[] };
        if (Array.isArray(json?.data) && json.data.length > 0) {
          states.length = 0;
          states.push(...json.data);
        }
      } catch {
        // ignore
      }
    }

    if (/\/board\/get_blocks/i.test(url) && post) {
      const sid = Number(post.SprintId ?? post.sprintId);
      const bid = Number(post.BoardId ?? post.boardId);
      if (Number.isFinite(sid)) sprintId = sid;
      if (Number.isFinite(bid)) boardId = bid;
      if (response.status() === 200) {
        try {
          const json = (await response.json()) as { data?: BoardBlock[] };
          if (Array.isArray(json?.data) && json.data.length > 0) {
            blocks.length = 0;
            blocks.push(...json.data);
            for (const b of json.data) {
              if (b?.id != null) blockIds.add(b.id);
            }
          }
        } catch {
          // ignore
        }
      }
    }

    if (/\/board\/get_sprints/i.test(url) && response.status() === 200) {
      try {
        const json = (await response.json()) as {
          data?: Array<{ id: number }>;
        };
        const first = json?.data?.[0];
        if (first?.id != null && sprintId == null) sprintId = first.id;
      } catch {
        // ignore
      }
    }

    if (/\/board\/get_tasks/i.test(url) && response.status() === 200 && post) {
      const blockId = Number(post.blockId);
      const sid = Number(post.sprintId);
      const bid = Number(post.boardId);
      if (Number.isFinite(blockId)) blockIds.add(blockId);
      if (Number.isFinite(sid)) sprintId = sid;
      if (Number.isFinite(bid)) boardId = bid;
      try {
        const json = (await response.json()) as { data?: ApiTaskListItem[] };
        if (Array.isArray(json?.data) && Number.isFinite(blockId)) {
          capturedTasks.set(blockId, json.data);
        }
      } catch {
        // ignore
      }
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  return {
    get sprintId() {
      return sprintId;
    },
    get boardId() {
      return boardId;
    },
    blockIds,
    states,
    blocks,
    capturedTasks,
    apiRequestHeaders,
    stop: () => {
      page.off("request", onRequest);
      page.off("response", onResponse);
    },
  };
}

export async function waitForSnifferTasks(
  sniffer: BoardApiSniffer,
  page: Page,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sniffer.capturedTasks.size > 0) return;
    await page.waitForTimeout(400);
  }
}
