/**
 * Явная цель задачи или ожидаемый результат в тексте описания (поле content в БД).
 * Без эвристики по общим словам («необходимо», «должен» и т.п.).
 * Отдельное поле «Результат» в UI не читается.
 */

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasExpectedResultPhrase(text: string): boolean {
  return normalizeForMatch(text).includes("ожидаемый результат");
}

function hasTaskGoalPhrase(text: string): boolean {
  return normalizeForMatch(text).includes("цель задачи");
}

/** «Цель» как заголовок строки (начало описания или новой строки). */
function hasGoalSectionHeading(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase().replace(/^\*+|\*+$/g, "");
    return lower.startsWith("цель");
  });
}

export function descriptionIndicatesGoal(
  descriptionText: string | null | undefined,
): boolean {
  const text = descriptionText?.trim() ?? "";
  if (!text) return false;
  return (
    hasExpectedResultPhrase(text) ||
    hasTaskGoalPhrase(text) ||
    hasGoalSectionHeading(text)
  );
}
