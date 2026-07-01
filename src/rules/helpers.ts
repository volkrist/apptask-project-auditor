import { htmlCommentContentToText } from "../comments/app-task-comments.js";
import type { RawTask, TaskComment } from "../adapters/apptask/types.js";
import type { AuditConfig } from "../config/audit-config.js";
import type { AppTaskUser } from "../users/app-task-users.js";
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

export function skip(ruleId: string, reason: string): RuleResult {
  return { ruleId, status: "SKIP", reason };
}

export function notApplicable(ruleId: string, reason = "Не применимо"): RuleResult {
  return { ruleId, status: "NOT_APPLICABLE", reason };
}

export function result(
  ruleId: string,
  status: RuleStatus,
  reason: string,
): RuleResult {
  return { ruleId, status, reason };
}

/** «35 ч», «1 ч 30 мин» → число часов (для ПВ из карточки AppTask). */
export function parsePlannedTimeHours(
  plannedTime: string | null | undefined,
): number | null {
  const s = plannedTime?.trim();
  if (!s) return null;
  const hMatch = s.match(/(\d+(?:[.,]\d+)?)\s*ч/i);
  const mMatch = s.match(/(\d+)\s*мин/i);
  let hours = 0;
  if (hMatch) hours += Number(hMatch[1]!.replace(",", "."));
  if (mMatch) hours += Number(mMatch[1]) / 60;
  return hours > 0 ? hours : null;
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
    tokenMatchesGenericBlacklist(tokens[0] ?? "", config)
  );
}

/** Все значимые слова названия — из blacklist общих слов. */
export function titleHasOnlyGenericWords(value: string, config: AuditConfig): boolean {
  const words = significantTitleWordsList(value);
  if (words.length === 0) return true;
  return words.every((word) => tokenMatchesGenericBlacklist(word, config));
}

/**
 * Название слишком общее по ТЗ: «правки», «доработки», «баги», «сайт», «проверить»
 * и близкие формы, в т.ч. «Правки по UI», но не «Работа с регламентами: …».
 */
export function isTitleTooGeneric(value: string, config: AuditConfig): boolean {
  if (isTitleBlacklisted(value, config)) return true;
  if (titleHasOnlyGenericWords(value, config)) return true;

  const sig = significantTitleWordsList(value);
  if (sig.length === 0) return true;
  if (!tokenMatchesGenericBlacklist(sig[0], config)) return false;

  return sig.length <= 2;
}

export function descriptionMatchesPatterns(
  text: string | null | undefined,
  patterns: readonly RegExp[],
): boolean {
  if (!text?.trim()) return false;
  return patterns.some((pattern) => pattern.test(text));
}

const TITLE_STOP_WORDS = new Set(["по", "за", "для", "и", "в", "на", "к", "о"]);

const GENERIC_TITLE_STEM_LEN = 5;

function stripTrailingPunct(word: string): string {
  return word.replace(/[.:,;!?…]+$/g, "");
}

function tokenEqualsGenericLexeme(token: string, generic: string): boolean {
  if (token === generic) return true;
  if (token.length < GENERIC_TITLE_STEM_LEN || generic.length < GENERIC_TITLE_STEM_LEN) {
    return false;
  }
  return token.slice(0, GENERIC_TITLE_STEM_LEN) === generic.slice(0, GENERIC_TITLE_STEM_LEN);
}

function tokenMatchesGenericBlacklist(token: string, config: AuditConfig): boolean {
  return config.genericTitleBlacklist.some((generic) =>
    tokenEqualsGenericLexeme(token, generic),
  );
}

export function significantTitleWordsList(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 0 && !TITLE_STOP_WORDS.has(word))
    .map(stripTrailingPunct);
}

function significantTitleWords(value: string): Set<string> {
  return new Set(significantTitleWordsList(value));
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

export function formatAllowedTaskTypes(config: AuditConfig): string {
  return config.requiredTaskTypes.join(", ");
}

/** Контекст для сообщений: теги и колонка доски (block_name в БД). */
export function describeTaskTypeContext(task: RawTask): string {
  const tags = task.tags.map((t) => t.trim()).filter(Boolean);
  const tagsLabel = tags.length > 0 ? tags.join(", ") : "нет";
  const block = task.category?.trim() || "не указана";
  return `теги: ${tagsLabel}; колонка доски: ${block}`;
}

/**
 * Тип задачи — один из requiredTaskTypes (баг, доработка, …).
 * Источники: (1) теги карточки, (2) категория только при точном совпадении или categoryTaskTypeMap.
 * Колонка доски (Frontend, UI/UX в БД) не является типом задачи.
 */
export function extractTaskType(
  task: RawTask,
  config: AuditConfig,
): string | null {
  const allowed = config.requiredTaskTypes.map((t) => t.toLowerCase());

  for (const tag of task.tags) {
    const lower = tag.toLowerCase().trim();
    if (!lower) continue;
    const exactTag = allowed.find((t) => lower === t);
    if (exactTag) return exactTag;
    const partialTag = allowed.find((t) => lower.includes(t));
    if (partialTag) return partialTag;
  }

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

/** Уникальные HTTP(S) URL для проверки links_reachable. */
export function collectLinkCheckTargets(task: RawTask): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    const url = value?.trim();
    if (!url || !isValidHttpUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  for (const url of collectLinkTargets(task)) add(url);

  const desc = task.descriptionText ?? "";
  const hrefRe = /https?:\/\/[^\s<>"']+/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(desc)) !== null) {
    add(m[0]!.replace(/[.,;:!?)]+$/, ""));
  }

  return out;
}

function truncateUrlList(urls: string[], max = 3): string {
  if (urls.length <= max) return urls.join(", ");
  const head = urls.slice(0, max).join(", ");
  return `${head} и ещё ${urls.length - max}`;
}

export function formatLinkCheckPassReason(checked: string[]): string {
  if (checked.length === 0) {
    return "Ссылок и вложений для проверки нет";
  }
  return `Проверено ссылок: ${checked.length} — все доступны (${truncateUrlList(checked)})`;
}

export function findKeywordInText(
  text: string | null | undefined,
  keywords: readonly string[],
): string | null {
  if (!text?.trim()) return null;
  const hay = text.toLowerCase();
  for (const keyword of keywords) {
    const needle = keyword.toLowerCase();
    if (hay.includes(needle)) return keyword;
  }
  return null;
}

export function isReviewStage(
  task: RawTask,
  reviewStageKeywords: readonly string[],
): boolean {
  const parts = [task.status, task.stage]
    .filter((value): value is string => !!value?.trim())
    .map((value) => value.toLowerCase());
  if (parts.length === 0) return false;
  const combined = parts.join(" ");
  return reviewStageKeywords.some((keyword) =>
    combined.includes(keyword.toLowerCase()),
  );
}

export function normalizePersonName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function assigneeNameMatches(
  assigneeName: string,
  expectedName: string,
): boolean {
  const a = normalizePersonName(assigneeName);
  const b = normalizePersonName(expectedName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function assigneeMatchesQaList(
  assignees: string[],
  qaTesters: readonly string[],
): boolean {
  if (qaTesters.length === 0) return true;
  return qaTesters.some((qa) =>
    assignees.some((name) => assigneeNameMatches(name, qa)),
  );
}

/** Текст комментария для keyword-правил: content (HTML) → plain, иначе text. */
export function commentPlainTextForRules(comment: TaskComment): string {
  const raw = comment.content ?? comment.text;
  return htmlCommentContentToText(raw) || comment.text?.trim() || "";
}

export type UnresolvedQuestionSource = "title" | "description" | "comment";

export type UnresolvedQuestionHit = {
  keyword: string;
  source: UnresolvedQuestionSource;
};

export function unresolvedQuestionSourceLabel(
  source: UnresolvedQuestionSource,
): string {
  switch (source) {
    case "title":
      return "названии";
    case "description":
      return "описании";
    case "comment":
      return "комментарии";
  }
}

export function findUnresolvedQuestionInCard(
  task: RawTask,
  keywords: readonly string[],
): UnresolvedQuestionHit | null {
  const titleHit = findKeywordInText(task.title, keywords);
  if (titleHit) return { keyword: titleHit, source: "title" };

  const descHit = findKeywordInText(task.descriptionText, keywords);
  if (descHit) return { keyword: descHit, source: "description" };

  for (const comment of task.comments ?? []) {
    const commentHit = findKeywordInText(
      commentPlainTextForRules(comment),
      keywords,
    );
    if (commentHit) return { keyword: commentHit, source: "comment" };
  }

  return null;
}

const QA_ROLE_RE =
  /\b(qa|тестировщик|тестирование)\b|qa\s*инженер/i;

export function isQaRoleText(role: string | null | undefined): boolean {
  if (!role?.trim()) return false;
  return QA_ROLE_RE.test(role.trim());
}

export function isQaUser(
  user: AppTaskUser,
  qaTesters: readonly string[],
): boolean {
  if (qaTesters.length > 0) {
    return qaTesters.some((qa) => assigneeNameMatches(user.realName, qa));
  }
  return isQaRoleText(user.roleUser) || isQaRoleText(user.role);
}

export function isCommentFromQa(
  comment: TaskComment,
  qaTesters: readonly string[],
  users?: AppTaskUser[],
): boolean {
  const name = comment.creatorName?.trim();
  if (name) {
    if (qaTesters.some((qa) => assigneeNameMatches(name, qa))) return true;
    const byName = (users ?? []).find((u) =>
      assigneeNameMatches(u.realName, name),
    );
    if (byName && isQaUser(byName, qaTesters)) return true;
  }
  if (comment.creatorId != null && users?.length) {
    const byId = users.find(
      (u) => String(u.id) === String(comment.creatorId),
    );
    if (byId && isQaUser(byId, qaTesters)) return true;
  }
  return false;
}

export function canDetermineQaFromUsers(
  users: AppTaskUser[] | undefined,
): boolean {
  if (!users?.length) return false;
  return users.some((u) => isQaRoleText(u.roleUser) || isQaRoleText(u.role));
}

export function hasAnyAssignee(task: RawTask): boolean {
  if (task.assignees.some((n) => n?.trim() && !n.includes("Добавить"))) {
    return true;
  }
  return task.assigneeRefs.some(
    (r) => r.name?.trim() && !r.name.includes("Добавить"),
  );
}

export function findQaAssignee(
  task: RawTask,
  users: AppTaskUser[] | undefined,
  qaTesters: readonly string[],
): { found: boolean; assigneeName?: string } {
  const refs =
    task.assigneeRefs.length > 0
      ? task.assigneeRefs
      : task.assignees.map((name) => ({ name, userId: null as string | null }));

  const byId = new Map(
    (users ?? []).map((u) => [String(u.id), u] as const),
  );
  const byName = new Map(
    (users ?? []).map((u) => [normalizePersonName(u.realName), u] as const),
  );

  for (const ref of refs) {
    const name = ref.name?.trim();
    if (!name || name.includes("Добавить")) continue;

    if (qaTesters.length > 0) {
      if (qaTesters.some((qa) => assigneeNameMatches(name, qa))) {
        return { found: true, assigneeName: name };
      }
      continue;
    }

    if (users?.length) {
      let user: AppTaskUser | undefined;
      if (ref.userId) user = byId.get(String(ref.userId));
      if (!user) user = byName.get(normalizePersonName(name));
      if (user && isQaUser(user, [])) {
        return { found: true, assigneeName: name };
      }
    }
  }

  return { found: false };
}
