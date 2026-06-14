/** Normalized column header matching (trim, lower-case, collapse whitespace, ё→е). */
export function normalizeColumnName(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е");
}

/** Sprint S1–S4 use «Эпик»; decomposition uses «Задача»/«Пункт». */
export const TASK_COLUMN_ALIASES = ["задача", "пункт", "эпик"] as const;
export const SUBTASK_COLUMN_ALIASES = ["под задача", "подзадача"] as const;
export const HOURS_COLUMN_ALIASES = [
  "оценка (ч)",
  "часы (оценка стаса). в апптаск",
] as const;
export const COMMENT_COLUMN_ALIASES = ["коментарий", "комментарий"] as const;

export function findColumnIndex(
  headers: string[],
  aliases: readonly string[],
): number {
  const normalized = headers.map(normalizeColumnName);
  for (const alias of aliases) {
    const idx = normalized.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function isLikelyHeaderRow(headers: string[]): boolean {
  const hasTask = findColumnIndex(headers, TASK_COLUMN_ALIASES) >= 0;
  if (!hasTask) return false;
  const hasHours = findColumnIndex(headers, HOURS_COLUMN_ALIASES) >= 0;
  const hasSub = findColumnIndex(headers, SUBTASK_COLUMN_ALIASES) >= 0;
  const hasPunkt = findColumnIndex(headers, ["пункт"]) >= 0;
  const hasZadacha = findColumnIndex(headers, ["задача"]) >= 0;
  const hasEpic = findColumnIndex(headers, ["эпик"]) >= 0;
  return (
    hasHours ||
    hasSub ||
    hasEpic ||
    (hasPunkt && hasZadacha) ||
    (hasZadacha && hasSub)
  );
}

export function findHeaderRow(
  values: string[][],
  maxScan = 80,
): { rowIndex: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(values.length, maxScan); i++) {
    const headers = (values[i] ?? []).map((h) => h.trim());
    if (isLikelyHeaderRow(headers)) {
      return { rowIndex: i, headers };
    }
  }
  return null;
}
