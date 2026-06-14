import type { RawTask, TaskComment } from "../../adapters/apptask/types.js";
import { commentPlainTextForRules } from "../helpers.js";

export function parseRuDateToMs(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function daysUntilDue(dueDate: string | null): number | null {
  const ms = parseRuDateToMs(dueDate);
  if (ms == null) return null;
  return (ms - Date.now()) / (1000 * 60 * 60 * 24);
}

export const DONE_STATUS_RE =
  /заверш|готово|\bdone\b|\bclosed\b|закрыт/i;

export const IN_PROGRESS_STATUS_RE =
  /в процессе|в работе|\bin progress\b|\bdoing\b/i;

export const TESTING_STATUS_RE =
  /на проверке|проверить тестировщику|\bqa\b|\btesting\b|\breview\b|проверка/i;

export const REVIEW_STATUS_RE = TESTING_STATUS_RE;

export const BLOCKED_RE =
  /blocked|blocker|блокирован|заблокирован|блокер/i;

const VAGUE_DONE_MARKERS =
  /^(готово|сделал|сделано|проверь|проверьте|готово к проверке|\bdone\b|\bready\b)[.!?\s]*$/i;

const VAGUE_DONE_CONTAINS =
  /(готово|сделал|сделано|проверь|проверьте|готово к проверке)/i;

const BLOCK_REASON_MARKERS = [
  "потому что",
  "причина",
  "ждём",
  "ждем",
  "ожидаем",
  "нет доступа",
  "зависит от",
  "блокирует",
  "нужен ответ",
  "нужен доступ",
  "согласование",
  "backend",
  "api",
  "заказчик",
];

const GENERIC_REWORK_REASON =
  /^(переделать|не готово|доработать|fix|rework)[.!?\s]*$/i;

const PROOF_RE =
  /https?:\/\/|www\.|\.png|\.jpg|\.jpeg|\.gif|\.webp|\.pdf|скрин|screenshot|видео|attachment|прикреп/i;

export function isCompletedStatus(status: string | null): boolean {
  return DONE_STATUS_RE.test(status ?? "");
}

export function isInProgressStatus(status: string | null): boolean {
  return IN_PROGRESS_STATUS_RE.test(status ?? "");
}

export function isTestingStatus(status: string | null): boolean {
  return TESTING_STATUS_RE.test(status ?? "");
}

export function isReviewStatus(status: string | null): boolean {
  return isTestingStatus(status);
}

export function isBlockedTask(task: RawTask): boolean {
  const parts = [
    task.status,
    task.stage,
    task.title,
    task.descriptionText,
    ...task.tags,
  ]
    .filter(Boolean)
    .join(" ");
  return BLOCKED_RE.test(parts);
}

export function computeLastActivityAt(task: RawTask): string | null {
  const times: number[] = [];
  if (task.updatedAt) {
    const t = new Date(task.updatedAt).getTime();
    if (!Number.isNaN(t)) times.push(t);
  }
  for (const h of task.history ?? []) {
    if (!h.date) continue;
    const t = new Date(h.date).getTime();
    if (!Number.isNaN(t)) times.push(t);
  }
  for (const c of task.comments ?? []) {
    if (!c.createTime) continue;
    const t = new Date(c.createTime).getTime();
    if (!Number.isNaN(t)) times.push(t);
  }
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

/** MVP: часы между датами, исключая сб/вс целиком. */
export function businessHoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const start = new Date(iso);
  const end = new Date();
  if (Number.isNaN(start.getTime()) || start >= end) return 0;

  let hours = 0;
  const cur = new Date(start);
  while (cur < end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const nextHour = new Date(cur);
      nextHour.setHours(cur.getHours() + 1, 0, 0, 0);
      const sliceEnd = nextHour < end ? nextHour : end;
      hours += (sliceEnd.getTime() - cur.getTime()) / (1000 * 60 * 60);
    }
    cur.setHours(cur.getHours() + 1, 0, 0, 0);
  }
  return hours;
}

export function formatHoursLabel(hours: number): string {
  if (hours < 24) return `${Math.floor(hours)} ч`;
  const days = Math.floor(hours / 24);
  return `${days} д (${Math.floor(hours)} ч)`;
}

export function deadlineUrgency(task: RawTask): {
  kind: "none" | "soon" | "overdue";
  days: number | null;
  label: string;
} {
  if (isCompletedStatus(task.status)) {
    return { kind: "none", days: null, label: "завершена" };
  }
  const days = daysUntilDue(task.dueDate);
  if (days == null) {
    return { kind: "none", days: null, label: "нет дедлайна" };
  }
  if (days < 0) {
    return {
      kind: "overdue",
      days,
      label: `просрочено на ${Math.abs(Math.ceil(days))} д`,
    };
  }
  if (days < 1) {
    return { kind: "soon", days, label: `осталось менее 1 дня (${Math.round(days * 24)} ч)` };
  }
  return { kind: "none", days, label: `${Math.ceil(days)} д до дедлайна` };
}

export function isHighPriorityOrCriticalBug(task: RawTask): {
  match: boolean;
  marker: string;
} {
  const p = task.priority?.toLowerCase() ?? "";
  if (/высок|high|critical|критич|urgent|сроч/i.test(p)) {
    return { match: true, marker: `priority=${task.priority}` };
  }
  for (const tag of task.tags) {
    if (/critical|критич|urgent|сроч|high/i.test(tag)) {
      return { match: true, marker: `tag=${tag}` };
    }
  }
  const hay = `${task.title ?? ""} ${task.descriptionText ?? ""}`.toLowerCase();
  if (/критичный баг|critical bug|блокер|blocker|срочно/i.test(hay)) {
    return { match: true, marker: "title/description" };
  }
  if (/\bbug\b|баг|ошибк|дефект/i.test(hay) && /критич|сроч|high/i.test(hay)) {
    return { match: true, marker: "bug+critical" };
  }
  return { match: false, marker: "" };
}

export function commentHasProof(comment: TaskComment): boolean {
  return PROOF_RE.test(commentPlainTextForRules(comment));
}

export function isVagueDoneCommentText(text: string): boolean {
  const t = text.trim();
  if (VAGUE_DONE_MARKERS.test(t)) return true;
  if (t.length <= 60 && VAGUE_DONE_CONTAINS.test(t) && !PROOF_RE.test(t)) {
    return true;
  }
  return false;
}

export function findVagueDoneComments(task: RawTask): TaskComment[] {
  return (task.comments ?? []).filter((c) => {
    const text = commentPlainTextForRules(c);
    if (!isVagueDoneCommentText(text)) return false;
    if (commentHasProof(c)) return false;
    return text.length <= 60 || VAGUE_DONE_MARKERS.test(text.trim());
  });
}

export function isInsufficientBlockReason(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return true;
  if (/^(blocked|заблокировано|блокер)[.!?\s]*$/i.test(t)) return true;
  return false;
}

export function findBlockReasonInTask(task: RawTask): TaskComment | null {
  const texts: Array<{ text: string; comment?: TaskComment }> = [
    { text: task.descriptionText ?? "" },
    ...(task.comments ?? []).map((c) => ({
      text: commentPlainTextForRules(c),
      comment: c,
    })),
  ];
  for (const entry of texts) {
    const t = entry.text.trim();
    if (t.length < 15) continue;
    const lower = t.toLowerCase();
    if (BLOCK_REASON_MARKERS.some((m) => lower.includes(m))) {
      if (!isInsufficientBlockReason(t)) {
        return entry.comment ?? null;
      }
    }
  }
  return null;
}

export function hasAdequateBlockReason(task: RawTask): boolean {
  return findBlockReasonInTask(task) !== null;
}

export function isGenericReworkReason(text: string): boolean {
  return GENERIC_REWORK_REASON.test(text.trim()) || text.trim().length < 15;
}

export function findReworkReasonComment(
  task: RawTask,
  afterIso: string,
  windowHours = 24,
): TaskComment | null {
  const after = new Date(afterIso).getTime();
  if (Number.isNaN(after)) return null;
  const windowMs = windowHours * 3600 * 1000;
  for (const c of task.comments ?? []) {
    if (!c.createTime) continue;
    const t = new Date(c.createTime).getTime();
    if (Number.isNaN(t)) continue;
    if (t < after - 2 * 3600 * 1000 || t > after + windowMs) continue;
    const text = commentPlainTextForRules(c);
    if (text.length < 15 || isGenericReworkReason(text)) continue;
    return c;
  }
  return null;
}

export function countTestingQueueTasks(tasks: RawTask[]): RawTask[] {
  return tasks.filter((t) => isTestingStatus(t.status));
}

export function dueDateMs(dueDate: string | null): number | null {
  return parseRuDateToMs(dueDate);
}
