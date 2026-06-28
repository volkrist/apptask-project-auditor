/**
 * Heuristic: явная цель/результат в тексте описания (поле content в БД).
 * Не использует отдельные поля карточки — только descriptionText.
 */

/** «Цель:», «Результат —», «Ожидаемый результат:» и т.п. */
const GOAL_SECTION_RE =
  /(?:^|[\n.!?\u2022-]\s*)(?:\*\*)?(?:цель|результат|ожидаемый результат|критерии(?:\s+готовности)?|итог)\s*(?:\*\*)?\s*[:\-—]/im;

export function descriptionIndicatesGoal(
  descriptionText: string | null | undefined,
  goalKeywords: readonly string[],
): boolean {
  const text = descriptionText?.trim() ?? "";
  if (!text) return false;
  if (GOAL_SECTION_RE.test(text)) return true;
  const lower = text.toLowerCase();
  return goalKeywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}
