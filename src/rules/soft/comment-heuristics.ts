/** Маркеры открытого вопроса в комментарии (не QA-отчёт). */
const OPEN_QUESTION_MARKERS =
  /уточнить|обсудить|ждем ответ|ждём ответ|непонятно|нужно уточнить/i;

const VERIFIED_SUCCESS_RE =
  /проверено|принято|approved|\bqa\s*ok\b|тестирование завершено|проверка завершена|блокеры?:\s*отсутствуют|блокеров:\s*нет|критических\s+замечаний:\s*нет/i;

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, " ");
}

/** QA-отчёт / результат тестирования — не открытый вопрос. */
export function isQaCompletionReport(text: string): boolean {
  const t = text.toLowerCase();
  const hasQaDone = /тестирование завершено|проверка завершена/i.test(t);
  if (!hasQaDone) return false;

  const hasPositiveOutcome =
    /блокеры?:\s*отсутствуют|блокеров:\s*нет|критических\s+замечаний:\s*нет|замечаний:\s*нет/i.test(
      t,
    ) || /[✅✔☑🧪]/.test(text);

  if (hasPositiveOutcome) return true;

  const cleaned = stripUrls(text);
  const hasExplicitQuestion =
    OPEN_QUESTION_MARKERS.test(cleaned) ||
    (/вопрос/i.test(cleaned) && !/вопросов?\s*(нет|не\s+было|отсутств)/i.test(cleaned));
  const hasQuestionMark =
    cleaned.includes("?") || cleaned.includes("？");

  return !hasExplicitQuestion && !hasQuestionMark;
}

/** Комментарий с маркером успешной проверки (проверено / тестирование завершено и т.п.). */
export function hasVerificationSuccessMarker(text: string): boolean {
  return VERIFIED_SUCCESS_RE.test(text);
}

/** Эвристика открытого вопроса в тексте комментария. */
export function isOpenQuestionComment(text: string): boolean {
  if (!text.trim()) return false;
  if (isQaCompletionReport(text)) return false;

  const cleaned = stripUrls(text);

  if (OPEN_QUESTION_MARKERS.test(cleaned)) return true;

  if (/вопрос/i.test(cleaned)) {
    if (/вопросов?\s*(нет|не\s+было|отсутств)/i.test(cleaned)) return false;
    return true;
  }

  return cleaned.includes("?") || cleaned.includes("？");
}
