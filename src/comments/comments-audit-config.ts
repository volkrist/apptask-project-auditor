import type { RawTask } from "../adapters/apptask/types.js";
import { isBlank, parseRuDate, startOfDay } from "../rules/helpers.js";

export type CommentsAuditMode = "off" | "candidates" | "all";

export type CommentsAuditConfig = {
  mode: CommentsAuditMode;
  concurrency: number;
  /** Макс. задач для загрузки комментариев (не общий limit аудита). */
  commentsLimit?: number;
};

const IN_PROGRESS_RE = /в\s*процессе|in\s*progress|\bprogress\b/i;
const REVIEW_RE = /проверк|review|на\s*провер/i;

function parseMode(raw: string | undefined): CommentsAuditMode {
  const v = raw?.trim().toLowerCase();
  if (v === "candidates" || v === "all") return v;
  return "off";
}

function parseConcurrency(raw: string | undefined): number {
  const n = Number(raw ?? "3");
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(Math.floor(n), 10);
}

function parseCommentsLimit(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(Math.floor(n), 300);
}

export function loadCommentsAuditConfig(
  overrides: Partial<CommentsAuditConfig> = {},
): CommentsAuditConfig {
  const config: CommentsAuditConfig = {
    mode: overrides.mode ?? parseMode(process.env.COMMENTS_AUDIT_MODE),
    concurrency: overrides.concurrency ?? parseConcurrency(
      process.env.COMMENTS_AUDIT_CONCURRENCY,
    ),
  };
  if (overrides.commentsLimit !== undefined) {
    config.commentsLimit = overrides.commentsLimit;
  } else {
    const fromEnv = parseCommentsLimit(process.env.COMMENTS_AUDIT_LIMIT);
    if (fromEnv !== undefined) config.commentsLimit = fromEnv;
  }
  return config;
}

export type CommentsFilterInput =
  | CommentsAuditMode
  | Pick<CommentsAuditConfig, "mode" | "commentsLimit">;

export function isInProgressTask(task: RawTask): boolean {
  const hay = `${task.status ?? ""} ${task.stage ?? ""}`.trim();
  if (!hay) return false;
  return IN_PROGRESS_RE.test(hay);
}

export function isOnReviewTask(task: RawTask): boolean {
  const hay = `${task.status ?? ""} ${task.stage ?? ""}`.trim();
  if (!hay) return false;
  return REVIEW_RE.test(hay);
}

export function isDueDateOverdue(task: RawTask): boolean {
  if (isBlank(task.dueDate)) return false;
  const due = parseRuDate(task.dueDate);
  if (!due) return false;
  return due < startOfDay(new Date());
}

/** Задача-кандидат для загрузки комментариев (режим candidates). */
export function shouldLoadCommentsForTask(task: RawTask): boolean {
  if (isInProgressTask(task)) return true;
  if (isBlank(task.dueDate)) return true;
  if (isDueDateOverdue(task)) return true;
  if (isOnReviewTask(task)) return true;
  return false;
}

export function filterTasksForCommentsLoad(
  tasks: RawTask[],
  input: CommentsFilterInput,
): RawTask[] {
  const mode = typeof input === "string" ? input : input.mode;
  const commentsLimit =
    typeof input === "string" ? undefined : input.commentsLimit;

  if (mode === "off") return [];

  const withId = tasks.filter((t) => t.id?.trim());
  let matched =
    mode === "all" ? withId : withId.filter(shouldLoadCommentsForTask);

  if (commentsLimit != null && commentsLimit > 0) {
    matched = matched.slice(0, commentsLimit);
  }

  return matched;
}
