/** Маркеры открытого вопроса в комментарии (не QA-отчёт). */
const OPEN_QUESTION_MARKERS =
  /уточнить|обсудить|ждем ответ|ждём ответ|непонятно|нужно уточнить/i;

const VERIFIED_SUCCESS_RE =
  /проверено|принято|approved|\bqa\s*ok\b|тестирование завершено|проверка завершена|блокеры?:\s*отсутствуют|блокеров:\s*нет|критических\s+замечаний:\s*нет|задачу\s+закрываю|закрываю\s+задачу|задача\s+закрыт|закрыт[аоы]\s+задач|заказчик\s+согласовал|с\s+заказчиком\s+согласован|согласован[ао].*закрыв|закрыв.*согласован|выполнен[ао]|готово\s+к\s+закрытию/i;

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
    ) ||
    (/[✅✔☑]/.test(text) &&
      !/критич|замечан|ошибк|не\s+работ|баг|дефект/i.test(t));

  if (hasPositiveOutcome) return true;

  if (
    /критич|замечан|ошибк|не\s+работ|баг|дефект/i.test(t) &&
    !/замечаний:\s*нет|блокеры?:\s*отсутств/i.test(t)
  ) {
    return false;
  }

  const cleaned = stripUrls(text);
  const hasExplicitQuestion =
    OPEN_QUESTION_MARKERS.test(cleaned) ||
    (/вопрос/i.test(cleaned) && !/вопросов?\s*(нет|не\s+было|отсутств)/i.test(cleaned));
  const hasQuestionMark =
    cleaned.includes("?") || cleaned.includes("？");

  return !hasExplicitQuestion && !hasQuestionMark;
}

const MOCKUP_APPROVAL_RE =
  /макет\s+(согласован|утвержд[её]н|принят|одобрен)|согласован\s+макет|утвержд[её]н\s+макет|mockup\s+approved|approved\s+mockup|макет\s+ok|макет\s+готов\s+к\s+разработке|согласование\s+макета|с\s+заказчиком\s+согласован|согласовано\s+с\s+заказчиком|утверждено\s+заказчиком|согласовано\s+заказчиком/i;

/** Маркер согласования макета в тексте (описание или комментарий). */
export function hasMockupApprovalMarker(text: string): boolean {
  return MOCKUP_APPROVAL_RE.test(text);
}

const TESTER_FEEDBACK_RE =
  /баг|ошибк|не\s+работ|замечан|вернут|rework|доработ|исправ|не\s+соответств|дефект|\bfail(?:ed)?\b|критич|некоррект|сломал|расхожден|ui\s*баг|регресс|отклон|поправ|не\s+ок\b|расходится/i;

/** Замечание тестировщика / QA-отчёт с проблемами (не «всё ок»). */
export function isTesterFeedbackComment(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isQaCompletionReport(t)) return false;

  if (/тестирование завершено|проверка завершена|🧪/i.test(t)) {
    if (
      /блокер|замечан|ошибк|не\s+работ|баг|дефект|\bfail|критич|некоррект/i.test(
        t,
      )
    ) {
      return true;
    }
  }

  return TESTER_FEEDBACK_RE.test(t);
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
