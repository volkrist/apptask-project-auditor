import type { RawTask } from "../adapters/apptask/types.js";
import type { AuditConfig } from "../config/audit-config.js";
import type { RuleResult, RuleStatus } from "./rule-types.js";

export function pass(ruleId: string, reason = "Проверка пройдена"): RuleResult {
  return { ruleId, status: "PASS", reason };
}

export function fail(ruleId: string, reason: string): RuleResult {
  return { ruleId, status: "FAIL", reason };
}

export function warn(ruleId: string, reason: string): RuleResult {
  return { ruleId, status: "WARN", reason };
}

export function result(
  ruleId: string,
  status: RuleStatus,
  reason: string,
): RuleResult {
  return { ruleId, status, reason };
}

export function parseRuDate(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isBlank(value: string | null | undefined): boolean {
  return !value?.trim();
}

export function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

const TITLE_STOP_WORDS = new Set(["по", "за", "для", "и", "в", "на", "к", "о"]);

function significantTitleWords(value: string): Set<string> {
  return new Set(
    normalizeTitle(value)
      .split(" ")
      .filter((word) => word && !TITLE_STOP_WORDS.has(word)),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const wordsA = significantTitleWords(a);
  const wordsB = significantTitleWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = intersection / union;

  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;
  const containment = longer.includes(shorter)
    ? shorter.length / longer.length
    : 0;

  return Math.max(jaccard, containment);
}

export function extractTaskType(
  task: RawTask,
  config: AuditConfig,
): string | null {
  const allowed = config.requiredTaskTypes.map((t) => t.toLowerCase());

  for (const tag of task.tags) {
    const lower = tag.toLowerCase();
    const hit = allowed.find((t) => lower.includes(t));
    if (hit) return hit;
  }

  if (task.category) {
    const lower = task.category.toLowerCase();
    const hit = allowed.find((t) => lower.includes(t));
    if (hit) return hit;
  }

  return null;
}

export function matchesAnyPattern(
  values: string[],
  patterns: readonly RegExp[],
): boolean {
  return values.some((value) =>
    patterns.some((pattern) => pattern.test(value)),
  );
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function collectLinkTargets(task: RawTask): string[] {
  const targets: string[] = [...task.links];
  for (const attachment of task.attachments) {
    if (attachment.url) targets.push(attachment.url);
  }
  return targets;
}
