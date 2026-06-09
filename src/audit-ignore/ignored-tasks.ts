import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TaskRef } from "../adapters/apptask/task-ref.js";

export type IgnoredTask = {
  taskId: string;
  url: string;
  boardUrl: string;
  reason?: string;
  createdAt: string;
  createdBy: string;
};

type IgnoredTasksFile = {
  ignoredTasks: IgnoredTask[];
};

const DATA_DIR = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  "data",
);
const STORE_PATH = path.join(DATA_DIR, "ignored-tasks.json");

function normalizeUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export function normalizeBoardUrl(input: string): string {
  const normalized = normalizeUrl(input);
  const match = normalized.match(/^(https?:\/\/[^?#]+\/board\/\d+)(?:\/\d+)?(?:[/?#].*)?$/i);
  return match?.[1] ?? normalized;
}

export function parseTaskUrl(input: string): {
  taskId: string;
  boardUrl: string;
  url: string;
} | null {
  const url = normalizeUrl(input);
  const match = url.match(/^(https?:\/\/[^?#]+\/board\/\d+)\/(\d+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return {
    boardUrl: normalizeBoardUrl(match[1]!),
    taskId: match[2]!,
    url,
  };
}

export const resolveTaskUrl = parseTaskUrl;

function ensureStoreExists(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    const initial: IgnoredTasksFile = { ignoredTasks: [] };
    fs.writeFileSync(STORE_PATH, `${JSON.stringify(initial, null, 2)}\n`, "utf8");
  }
}

function readStore(): IgnoredTasksFile {
  ensureStoreExists();
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<IgnoredTasksFile>;
    if (!parsed || !Array.isArray(parsed.ignoredTasks)) {
      console.warn("[audit-ignore] warn: invalid JSON format, using empty list");
      return { ignoredTasks: [] };
    }
    return {
      ignoredTasks: parsed.ignoredTasks
        .filter((x): x is IgnoredTask => !!x?.taskId && !!x?.url && !!x?.boardUrl)
        .map((x) => ({
          ...x,
          taskId: String(x.taskId),
          url: normalizeUrl(x.url),
          boardUrl: normalizeBoardUrl(x.boardUrl),
        })),
    };
  } catch (err) {
    console.warn("[audit-ignore] warn: cannot parse ignored-tasks.json", err);
    return { ignoredTasks: [] };
  }
}

function writeStore(file: IgnoredTasksFile): void {
  ensureStoreExists();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

export function loadIgnoredTasks(): IgnoredTask[] {
  const file = readStore();
  console.log(`[audit-ignore] loaded=${file.ignoredTasks.length}`);
  return file.ignoredTasks;
}

export function addIgnoredTask(params: {
  url: string;
  reason?: string;
  createdBy: string;
}): { added: boolean; task: IgnoredTask | null; message?: string } {
  const parsed = parseTaskUrl(params.url);
  if (!parsed) {
    return { added: false, task: null, message: "Некорректный URL карточки." };
  }
  const file = readStore();
  const exists = file.ignoredTasks.some(
    (x) =>
      x.taskId === parsed.taskId && normalizeBoardUrl(x.boardUrl) === parsed.boardUrl,
  );
  if (exists) {
    return { added: false, task: null };
  }
  const task: IgnoredTask = {
    taskId: parsed.taskId,
    url: parsed.url,
    boardUrl: parsed.boardUrl,
    reason: params.reason?.trim() || undefined,
    createdAt: new Date().toISOString(),
    createdBy: params.createdBy,
  };
  file.ignoredTasks.push(task);
  writeStore(file);
  return { added: true, task };
}

export function removeIgnoredTask(url: string): { removed: boolean } {
  const parsed = parseTaskUrl(url);
  if (!parsed) return { removed: false };
  const file = readStore();
  const next = file.ignoredTasks.filter(
    (x) =>
      !(
        x.taskId === parsed.taskId &&
        normalizeBoardUrl(x.boardUrl) === parsed.boardUrl
      ),
  );
  if (next.length === file.ignoredTasks.length) return { removed: false };
  writeStore({ ignoredTasks: next });
  return { removed: true };
}

export function listIgnoredTasks(boardUrl?: string): IgnoredTask[] {
  const all = readStore().ignoredTasks;
  if (!boardUrl) return all;
  const normalized = normalizeBoardUrl(boardUrl);
  return all.filter((x) => normalizeBoardUrl(x.boardUrl) === normalized);
}

export function filterTaskRefsByIgnored(
  refs: TaskRef[],
  boardUrl: string,
): { refs: TaskRef[]; skippedCount: number; skippedUrls: string[] } {
  const ignored = loadIgnoredTasks();
  const normalizedBoard = normalizeBoardUrl(boardUrl);
  const byTaskId = new Set(
    ignored
      .filter((x) => normalizeBoardUrl(x.boardUrl) === normalizedBoard)
      .map((x) => x.taskId),
  );

  if (byTaskId.size === 0) {
    console.log("[audit-ignore] skipped=0");
    return { refs, skippedCount: 0, skippedUrls: [] };
  }

  const filtered = refs.filter((ref) => !ref.taskId || !byTaskId.has(ref.taskId));
  const skippedCount = refs.length - filtered.length;
  const skippedUrls = refs
    .filter((ref) => ref.taskId && byTaskId.has(ref.taskId))
    .map((ref) => `${normalizedBoard}/${ref.taskId}`);
  console.log(`[audit-ignore] skipped=${skippedCount}`);
  return { refs: filtered, skippedCount, skippedUrls };
}

export function filterTasksByIgnored(
  tasks: Array<{ id: string | null; url: string | null }>,
  boardUrl: string,
): { tasks: typeof tasks; skippedCount: number; skippedUrls: string[] } {
  const ignored = loadIgnoredTasks();
  const normalizedBoard = normalizeBoardUrl(boardUrl);
  const byTaskId = new Set(
    ignored
      .filter((x) => normalizeBoardUrl(x.boardUrl) === normalizedBoard)
      .map((x) => x.taskId),
  );
  if (byTaskId.size === 0) {
    console.log("[audit-ignore] skipped=0");
    return { tasks, skippedCount: 0, skippedUrls: [] };
  }
  const filtered = tasks.filter((task) => !task.id || !byTaskId.has(task.id));
  const skipped = tasks.length - filtered.length;
  const skippedUrls = tasks
    .filter((task) => task.id && byTaskId.has(task.id))
    .map((task) => task.url ?? `${normalizedBoard}/${task.id}`);
  console.log(`[audit-ignore] skipped=${skipped}`);
  return { tasks: filtered, skippedCount: skipped, skippedUrls };
}

