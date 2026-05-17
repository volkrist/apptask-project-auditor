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

export function countTitleWords(value: string): number {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 0).length;
}

/** Значимые токены названия (целые слова, без пунктуации). */
export function titleTokens(value: string): string[] {
  return normalizeTitle(value)
    .split(/[^a-zа-яё0-9]+/i)
    .filter((token) => token.length > 0);
}

/** Blacklist: только если всё название — одно запрещённое слово. */
export function isTitleBlacklisted(value: string, config: AuditConfig): boolean {
  const normalized = normalizeTitle(value);
  if (config.genericTitleBlacklist.includes(normalized)) return true;

  const tokens = titleTokens(value);
  return (
    tokens.length === 1 &&
    config.genericTitleBlacklist.includes(tokens[0] ?? "")
  );
}

/** Все значимые слова названия — из blacklist общих слов. */
export function titleHasOnlyGenericWords(value: string, config: AuditConfig): boolean {
  const words = normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 0 && !TITLE_STOP_WORDS.has(word));
  if (words.length === 0) return true;
  return words.every((word) =>
    config.genericTitleBlacklist.some((generic) => word === generic),
  );
}

export function descriptionMatchesPatterns(
  text: string | null | undefined,
  patterns: readonly RegExp[],
): boolean {
  if (!text?.trim()) return false;
  return patterns.some((pattern) => pattern.test(text));
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

  if (task.category) {
    const category = task.category.toLowerCase().trim();
    const mapped = config.categoryTaskTypeMap[category];
    if (mapped) {
      const normalized = mapped.toLowerCase();
      if (allowed.includes(normalized)) return normalized;
    }
    const exactCategory = allowed.find((t) => category === t);
    if (exactCategory) return exactCategory;
  }

  for (const tag of task.tags) {
    const lower = tag.toLowerCase().trim();
    const exactTag = allowed.find((t) => lower === t);
    if (exactTag) return exactTag;
    const partialTag = allowed.find((t) => lower.includes(t));
    if (partialTag) return partialTag;
  }

  if (task.category) {
    const category = task.category.toLowerCase();
    const partialCategory = allowed.find((t) => category.includes(t));
    if (partialCategory) return partialCategory;
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
