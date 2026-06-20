import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import { getEvidenceSpecByRuleId } from "../config/contract-rule-evidence.js";
import { REVIEW_STATUS_ALIASES } from "../config/contract-rule-evidence.js";
import { auditConfig } from "../config/audit-config.js";
import type {
  EvidenceItem,
  EvidenceResult,
  EvidenceStatus,
} from "../rules/evidence-types.js";
import {
  isCompletedStatus,
  isTestingStatus,
} from "../rules/status/status-helpers.js";
import { commentPlainTextForRules } from "../rules/helpers.js";
import { isOpenQuestionComment } from "../rules/soft/comment-heuristics.js";

function taskLabel(card: CardAudit): string {
  const id = card.task.id ? `№${card.task.id}` : "без номера";
  const title = card.task.title?.trim() || "(без названия)";
  return `${id} — ${title}`;
}

function cardToEvidenceItem(
  card: CardAudit,
  reason: string,
  source: string,
): EvidenceItem {
  return {
    objectLabel: taskLabel(card),
    reason,
    source,
    link: card.task.url,
    taskId: card.task.id,
  };
}

function ruleResultFor(card: CardAudit, ruleId: string): RuleResult | undefined {
  return card.results.find((r) => r.ruleId === ruleId);
}

function isPseudoSkip(r: RuleResult): boolean {
  return r.status === "PASS" && r.reason.includes("(SKIP)");
}

function isNotInEstimateSkip(r: RuleResult): boolean {
  return (
    (r.status === "SKIP" || isPseudoSkip(r)) &&
    (r.reason.includes("Нет строки сметы") ||
      r.reason.includes("ПВ не проверялось") ||
      r.reason.includes("не найдена в утверждённой смете"))
  );
}

function statusDistribution(result: AuditResult): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const card of result.cards) {
    const status = card.task.status?.trim() || "(пусто)";
    dist[status] = (dist[status] ?? 0) + 1;
  }
  return dist;
}

function countReviewCandidates(result: AuditResult): number {
  let n = 0;
  for (const card of result.cards) {
    if (isTestingStatus(card.task.status)) n++;
  }
  return n;
}

function scanOpenQuestionsDebug(result: AuditResult): Record<string, number> {
  let commentsTotal = 0;
  let commentsWithQuestionMark = 0;
  let questionCandidates = 0;
  let violations = 0;
  let withReply = 0;
  let unlinked = 0;

  for (const card of result.cards) {
    const r = ruleResultFor(card, "open_questions_closed");
    if (r?.status === "WARN" || r?.status === "FAIL") violations++;

    for (const comment of card.task.comments ?? []) {
      commentsTotal++;
      const text = commentPlainTextForRules(comment);
      if (text.includes("?")) commentsWithQuestionMark++;
      if (isOpenQuestionComment(text)) {
        questionCandidates++;
        if (r?.status === "PASS") withReply++;
        if (r?.status === "WARN") unlinked++;
      }
    }
  }

  return {
    commentsTotal,
    commentsWithQuestionMark,
    questionCandidates,
    violations,
    withReply,
    unlinked,
  };
}

function scanKeywordMarkersDebug(result: AuditResult): Record<string, number | string> {
  const markers = auditConfig.unresolvedQuestionKeywords;
  let cardsChecked = result.cards.length;
  let matches = 0;

  for (const card of result.cards) {
    const r = ruleResultFor(card, "unresolved_question_keywords_in_card");
    if (r?.status === "WARN" || r?.status === "FAIL") matches++;
  }

  return {
    cardsChecked,
    markersSearched: markers.join(", "),
    searchFields: "title, description, comments",
    matchesFound: matches,
  };
}

function buildDeadlineEvidence(
  result: AuditResult,
  spec: NonNullable<ReturnType<typeof getEvidenceSpecByRuleId>>,
): EvidenceResult {
  const ruleId = "deadline_less_than_one_day";
  const scopeCount = result.meta.cardsChecked;
  const violationEvidence: EvidenceItem[] = [];
  const notCheckedEvidence: EvidenceItem[] = [];
  let candidateCount = 0;
  let violationCount = 0;

  for (const card of result.cards) {
    const r = ruleResultFor(card, ruleId);
    if (!r) continue;
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      notCheckedEvidence.push(
        cardToEvidenceItem(card, r.reason, "AppTask DB"),
      );
      continue;
    }
    if (r.status === "NOT_APPLICABLE") continue;
    if (isCompletedStatus(card.task.status)) continue;
    if (r.reason.includes("Нет дедлайна")) continue;
    if (r.status === "PASS" && r.reason === "OK") continue;

    candidateCount++;
    if (r.status === "WARN" || r.status === "FAIL") {
      violationCount++;
      violationEvidence.push(
        cardToEvidenceItem(card, r.reason, "AppTask DB: deadline, status"),
      );
    }
  }

  const notCheckedCount = notCheckedEvidence.length;
  const passedCount = candidateCount - violationCount;
  let status: EvidenceStatus = "OK";
  if (violationCount > 0) {
    const hasFail = result.cards.some(
      (c) => ruleResultFor(c, ruleId)?.status === "FAIL",
    );
    status = hasFail ? "FAIL" : "WARN";
  } else if (notCheckedCount > 0 && candidateCount === 0) {
    status = "SKIP";
  }

  const summaryLabel =
    candidateCount === 0
      ? "Кандидатов для проверки нет"
      : violationCount > 0
        ? `${violationCount} с нарушениями`
        : `${candidateCount} с дедлайном < 1 дня — нарушений нет`;

  return {
    ruleId,
    contractNum: spec.num,
    scopeCount,
    candidateCount,
    passedCount,
    violationCount,
    notCheckedCount,
    status,
    automationLevel: spec.automationLevel,
    sources: spec.sources.split(";").map((s) => s.trim()),
    candidateEvidence: [],
    violationEvidence,
    notCheckedEvidence,
    summaryLabel,
  };
}

function buildScrumPvEvidence(
  result: AuditResult,
  spec: NonNullable<ReturnType<typeof getEvidenceSpecByRuleId>>,
): EvidenceResult {
  const ruleId = "scrum_planned_hours_present";
  const scopeCount = result.meta.cardsChecked;
  const violationEvidence: EvidenceItem[] = [];
  const notCheckedEvidence: EvidenceItem[] = [];
  let candidateCount = 0;
  let violationCount = 0;
  let skippedAll = true;

  for (const card of result.cards) {
    const r = ruleResultFor(card, ruleId);
    if (!r) continue;

    if (r.status === "SKIP" && !isNotInEstimateSkip(r)) {
      notCheckedEvidence.push(
        cardToEvidenceItem(card, r.reason, "Scrum / смета"),
      );
      continue;
    }

    if (isNotInEstimateSkip(r)) {
      notCheckedEvidence.push(
        cardToEvidenceItem(
          card,
          "задача не найдена в смете, поэтому ПВ не проверялось",
          "Scrum / смета",
        ),
      );
      continue;
    }

    skippedAll = false;
    if (r.status === "NOT_APPLICABLE") continue;

    candidateCount++;
    if (r.status === "WARN") {
      violationCount++;
      violationEvidence.push(
        cardToEvidenceItem(card, r.reason, "Scrum / смета: ПВ"),
      );
    }
  }

  const notCheckedCount = notCheckedEvidence.length;
  const passedCount = candidateCount - violationCount;
  const notInEstimateOnly =
    notCheckedCount > 0 &&
    notCheckedEvidence.every((e) =>
      e.reason.includes("не найдена в смете"),
    );

  let status: EvidenceStatus = "OK";
  if (violationCount > 0) {
    status = "WARN";
  } else if (notCheckedCount > 0 && (candidateCount > 0 || notInEstimateOnly)) {
    status = "PARTIAL";
  } else if (skippedAll && notCheckedCount > 0) {
    status = "SKIP";
  }

  const summaryLabel =
    candidateCount === 0 && notCheckedCount === 0
      ? "Кандидатов для проверки нет"
      : [
          candidateCount > 0 ? `${candidateCount} в Scrum / смете` : null,
          notCheckedCount > 0 ? `не проверено: ${notCheckedCount}` : null,
        ]
          .filter(Boolean)
          .join("; ");

  return {
    ruleId,
    contractNum: spec.num,
    scopeCount,
    candidateCount,
    passedCount,
    violationCount,
    notCheckedCount,
    status,
    automationLevel: spec.automationLevel,
    sources: spec.sources.split(";").map((s) => s.trim()),
    candidateEvidence: [],
    violationEvidence,
    notCheckedEvidence,
    summaryLabel,
  };
}

function buildReviewStaleEvidence(
  result: AuditResult,
  spec: NonNullable<ReturnType<typeof getEvidenceSpecByRuleId>>,
): EvidenceResult {
  const ruleId = "review_stale";
  const scopeCount = result.meta.cardsChecked;
  const dist = statusDistribution(result);
  const reviewNow = countReviewCandidates(result);
  const violationEvidence: EvidenceItem[] = [];
  const candidateEvidence: EvidenceItem[] = [];
  let violationCount = 0;

  for (const card of result.cards) {
    if (!isTestingStatus(card.task.status)) continue;
    candidateEvidence.push(
      cardToEvidenceItem(
        card,
        `статус: ${card.task.status ?? "—"}`,
        "AppTask DB: current status",
      ),
    );
    const r = ruleResultFor(card, ruleId);
    if (r?.status === "WARN" || r?.status === "FAIL") {
      violationCount++;
      violationEvidence.push(
        cardToEvidenceItem(card, r.reason, "AppTask status history"),
      );
    }
  }

  const candidateCount = candidateEvidence.length;
  const passedCount = candidateCount - violationCount;
  const status: EvidenceStatus = violationCount > 0 ? "WARN" : "OK";

  const distStr = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}: ${n}`)
    .join("; ");

  return {
    ruleId,
    contractNum: spec.num,
    scopeCount,
    candidateCount,
    passedCount,
    violationCount,
    notCheckedCount: 0,
    status,
    automationLevel: spec.automationLevel,
    sources: spec.sources.split(";").map((s) => s.trim()),
    candidateEvidence,
    violationEvidence,
    notCheckedEvidence: [],
    debug: {
      reviewStatusAliases: REVIEW_STATUS_ALIASES.join(", "),
      currentReviewTasks: reviewNow,
      statusDistribution: distStr,
    },
    summaryLabel:
      candidateCount === 0
        ? "Текущих задач в QA/review: 0"
        : violationCount > 0
          ? `${violationCount} без движения > 1 р.д.`
          : `${candidateCount} на проверке — нарушений нет`,
  };
}

function buildOpenQuestionsEvidence(
  result: AuditResult,
  spec: NonNullable<ReturnType<typeof getEvidenceSpecByRuleId>>,
): EvidenceResult {
  const ruleId = "open_questions_closed";
  const scopeCount = result.meta.cardsChecked;
  const debug = scanOpenQuestionsDebug(result);
  const violationEvidence: EvidenceItem[] = [];
  const candidateCount = debug.questionCandidates;
  let violationCount = 0;

  for (const card of result.cards) {
    const r = ruleResultFor(card, ruleId);
    if (r?.status === "WARN" || r?.status === "FAIL") {
      violationCount++;
      violationEvidence.push(
        cardToEvidenceItem(card, r.reason, "AppTask comments"),
      );
    }
  }

  let status: EvidenceStatus = "OK";
  if (violationCount > 0) {
    status = "WARN";
  } else if (spec.automationLevel === "PARTIAL" && candidateCount > 0) {
    status = "PARTIAL";
  }

  return {
    ruleId,
    contractNum: spec.num,
    scopeCount,
    candidateCount,
    passedCount: candidateCount - violationCount,
    violationCount,
    notCheckedCount: debug.unlinked,
    status,
    automationLevel: spec.automationLevel,
    sources: spec.sources.split(";").map((s) => s.trim()),
    candidateEvidence: [],
    violationEvidence,
    notCheckedEvidence: [],
    debug: {
      ...debug,
      note:
        candidateCount === 0
          ? "по найденным маркерам не найдено"
          : "связь вопрос→ответ эвристическая",
    },
    summaryLabel:
      candidateCount === 0
        ? "0 открытых вопросов по маркерам"
        : `${violationCount} открытых вопросов`,
  };
}

function buildBlockedAssigneeEvidence(
  result: AuditResult,
  spec: NonNullable<ReturnType<typeof getEvidenceSpecByRuleId>>,
): EvidenceResult {
  const ruleId = "blocked_assignee_not_allowed";
  const scopeCount = result.meta.cardsChecked;
  const violationEvidence: EvidenceItem[] = [];
  const notCheckedEvidence: EvidenceItem[] = [];
  let candidateCount = 0;
  let violationCount = 0;
  let allSkipped = true;

  for (const card of result.cards) {
    const r = ruleResultFor(card, ruleId);
    if (!r) continue;
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      allSkipped = true;
      continue;
    }
    allSkipped = false;
    if (r.status === "NOT_APPLICABLE") continue;
    candidateCount++;
    if (r.status === "WARN" || r.status === "FAIL") {
      violationCount++;
      violationEvidence.push(
        cardToEvidenceItem(card, r.reason, "AppTask users API"),
      );
    }
  }

  let status: EvidenceStatus = "OK";
  if (allSkipped && candidateCount === 0) {
    status = "SKIP";
  } else if (violationCount > 0) {
    status = "FAIL";
  } else {
    status = "PARTIAL";
  }

  if (status === "PARTIAL" || status === "SKIP") {
    notCheckedEvidence.push({
      objectLabel: "уволенные / неактивные",
      reason: spec.notChecked,
      source: "HR / users — не подключён",
      link: result.meta.boardUrl,
    });
  }

  return {
    ruleId,
    contractNum: spec.num,
    scopeCount,
    candidateCount,
    passedCount: candidateCount - violationCount,
    violationCount,
    notCheckedCount: notCheckedEvidence.length,
    status,
    automationLevel: spec.automationLevel,
    sources: spec.sources.split(";").map((s) => s.trim()),
    candidateEvidence: [],
    violationEvidence,
    notCheckedEvidence,
    summaryLabel:
      allSkipped && candidateCount === 0
        ? "источник недоступен"
        : `${candidateCount} назначений проверено`,
  };
}

function buildGenericEvidence(result: AuditResult, ruleId: string): EvidenceResult {
  const spec = getEvidenceSpecByRuleId(ruleId);
  if (!spec) {
    throw new Error(`No evidence spec for ruleId: ${ruleId}`);
  }

  const scopeCount = result.meta.cardsChecked;
  const violationEvidence: EvidenceItem[] = [];
  const notCheckedEvidence: EvidenceItem[] = [];
  let candidateCount = 0;
  let violationCount = 0;
  let skippedAll = true;

  for (const card of result.cards) {
    const r = ruleResultFor(card, ruleId);
    if (!r) continue;
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      notCheckedEvidence.push(cardToEvidenceItem(card, r.reason, spec.sources));
      continue;
    }
    skippedAll = false;
    if (r.status === "NOT_APPLICABLE") continue;
    candidateCount++;
    if (r.status === "WARN" || r.status === "FAIL") {
      violationCount++;
      violationEvidence.push(cardToEvidenceItem(card, r.reason, spec.sources));
    }
  }

  const entityFindings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === ruleId,
  );
  for (const f of entityFindings) {
    if (f.status === "WARN" || f.status === "FAIL") {
      violationCount++;
      violationEvidence.push({
        objectLabel: f.objectLabel,
        reason: f.reason,
        source: f.source ?? spec.sources,
        link: f.link,
      });
    }
    if (f.status === "SKIP") {
      notCheckedEvidence.push({
        objectLabel: f.objectLabel,
        reason: f.reason,
        source: f.source ?? spec.sources,
        link: f.link,
      });
    }
    if (f.status === "PASS" || f.status === "WARN" || f.status === "FAIL") {
      skippedAll = false;
      candidateCount = Math.max(candidateCount, 1);
    }
  }

  const notCheckedCount = notCheckedEvidence.length;
  const passedCount = Math.max(0, candidateCount - violationCount);
  let status: EvidenceStatus = "OK";
  if (skippedAll && candidateCount === 0 && notCheckedCount > 0) {
    status = "SKIP";
  } else if (violationCount > 0) {
    const hasFail =
      result.cards.some((c) => ruleResultFor(c, ruleId)?.status === "FAIL") ||
      entityFindings.some((f) => f.status === "FAIL");
    status = hasFail ? "FAIL" : "WARN";
  } else if (
    notCheckedCount > 0 &&
    (spec.automationLevel === "PARTIAL" ||
      spec.automationLevel === "SOURCE_UNAVAILABLE")
  ) {
    status = "PARTIAL";
  }

  const summaryLabel =
    candidateCount === 0 && notCheckedCount === 0
      ? "Кандидатов для проверки нет"
      : violationCount > 0
        ? `${violationCount} с нарушениями`
        : `${candidateCount} кандидатов — нарушений нет`;

  return {
    ruleId,
    contractNum: spec.num,
    scopeCount,
    candidateCount,
    passedCount,
    violationCount,
    notCheckedCount,
    status,
    automationLevel: spec.automationLevel,
    sources: spec.sources.split(";").map((s) => s.trim()),
    candidateEvidence: [],
    violationEvidence,
    notCheckedEvidence,
    summaryLabel,
  };
}

const SPECIAL_BUILDERS: Record<
  string,
  (
    result: AuditResult,
    spec: NonNullable<ReturnType<typeof getEvidenceSpecByRuleId>>,
  ) => EvidenceResult
> = {
  deadline_less_than_one_day: buildDeadlineEvidence,
  scrum_planned_hours_present: buildScrumPvEvidence,
  review_stale: buildReviewStaleEvidence,
  open_questions_closed: buildOpenQuestionsEvidence,
  blocked_assignee_not_allowed: buildBlockedAssigneeEvidence,
};

/** Собрать EvidenceResult для одного ruleId. */
export function buildEvidenceResult(ruleId: string, result: AuditResult): EvidenceResult {
  const spec = getEvidenceSpecByRuleId(ruleId);
  if (!spec) {
    throw new Error(`No evidence spec for ruleId: ${ruleId}`);
  }
  const special = SPECIAL_BUILDERS[ruleId];
  if (special) return special(result, spec);
  const evidence = buildGenericEvidence(result, ruleId);
  if (ruleId === "unresolved_question_keywords_in_card") {
    evidence.debug = scanKeywordMarkersDebug(result);
    if (evidence.candidateCount === 0 && evidence.violationCount === 0) {
      evidence.summaryLabel = "0 найденных маркеров";
    }
  }
  return evidence;
}

/** Собрать EvidenceResult для всех ruleId из матрицы. */
export function buildAllEvidenceResults(result: AuditResult): EvidenceResult[] {
  const seen = new Set<string>();
  const out: EvidenceResult[] = [];
  for (const card of result.cards) {
    for (const r of card.results) {
      if (seen.has(r.ruleId)) continue;
      seen.add(r.ruleId);
      out.push(buildEvidenceResult(r.ruleId, result));
    }
  }
  for (const f of result.entityFindings ?? result.meta.entityFindings ?? []) {
    if (seen.has(f.ruleId)) continue;
    seen.add(f.ruleId);
    out.push(buildEvidenceResult(f.ruleId, result));
  }
  return out.sort((a, b) => a.contractNum - b.contractNum);
}

/** Пять эталонных ruleId для демонстрации EvidenceResult. */
export const EXAMPLE_EVIDENCE_RULE_IDS = [
  "deadline_less_than_one_day",
  "scrum_planned_hours_present",
  "review_stale",
  "open_questions_closed",
  "blocked_assignee_not_allowed",
] as const;

export function buildExampleEvidenceResults(result: AuditResult): EvidenceResult[] {
  return EXAMPLE_EVIDENCE_RULE_IDS.map((ruleId) => buildEvidenceResult(ruleId, result));
}
