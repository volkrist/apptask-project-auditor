import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import { collectLinkCheckTargets } from "../rules/helpers.js";
import { isTestingStatus } from "../rules/status/status-helpers.js";
import {
  ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
  ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
} from "../rules/soft/tracking-hours-rules.js";
import type { RegistryOutcome } from "./check-registry-stats.js";

export type RuleCandidateAccount = {
  scopeLabel: string;
  candidatesLabel: string;
  unavailableLabel: string;
  fail: number;
  warn: number;
  outcome: RegistryOutcome;
};

function taskResultsForRule(result: AuditResult, ruleId: string): RuleResult[] {
  const out: RuleResult[] = [];
  for (const card of result.cards) {
    for (const r of card.results) {
      if (r.ruleId === ruleId) out.push(r);
    }
  }
  return out;
}

function ruleResultForCard(card: CardAudit, ruleId: string): RuleResult | undefined {
  return card.results.find((r) => r.ruleId === ruleId);
}

/** Задача с сопоставимым фактом и ПВ (не SKIP / «нет ПВ»). */
function isPvCompareCandidate(card: CardAudit): boolean {
  const r = ruleResultForCard(card, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (!r || r.status === "SKIP" || r.status === "NOT_APPLICABLE") return false;
  if (r.reason.includes("Нет ПВ")) return false;
  return r.reason.startsWith("Факт ");
}

/** Задача с превышением ПВ выше порога (+20%). */
function isEstimateOverrunCandidate(card: CardAudit): boolean {
  const actual = ruleResultForCard(card, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (actual?.status === "WARN") return true;
  const comment = ruleResultForCard(card, ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE);
  if (comment?.status === "WARN") return true;
  if (comment?.reason.includes("Есть комментарий с объяснением")) return true;
  return false;
}

function estimateOverrunCommentAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const overrunCards = result.cards.filter(isEstimateOverrunCandidate);
  const commentResults = overrunCards
    .map((c) => ruleResultForCard(c, ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE))
    .filter((r): r is RuleResult => r != null);
  const warn = commentResults.filter((r) => r.status === "WARN").length;
  const fail = commentResults.filter((r) => r.status === "FAIL").length;

  if (overrunCards.length === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 задач с превышением ПВ",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      warn + fail > 0
        ? `${warn + fail} с превышением без комментария`
        : `${overrunCards.length} с превышением — комментарии есть`,
    unavailableLabel: "—",
    fail,
    warn,
    outcome: outcomeFromCounts(fail, warn),
  };
}

function actualHoursExceedsAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const compareCards = result.cards.filter(isPvCompareCandidate);
  const results = compareCards
    .map((c) => ruleResultForCard(c, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE))
    .filter((r): r is RuleResult => r != null);
  const warn = results.filter((r) => r.status === "WARN").length;
  const fail = results.filter((r) => r.status === "FAIL").length;

  if (compareCards.length === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 задач с фактом и ПВ для сравнения",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      warn + fail > 0
        ? `${warn + fail} с превышением ПВ`
        : `${compareCards.length} с фактом и ПВ — превышений нет`,
    unavailableLabel: "—",
    fail,
    warn,
    outcome: outcomeFromCounts(fail, warn),
  };
}

export function countEstimateOverrunCandidates(result: AuditResult): number {
  return result.cards.filter(isEstimateOverrunCandidate).length;
}

export function countPvCompareCandidates(result: AuditResult): number {
  return result.cards.filter(isPvCompareCandidate).length;
}

function isPseudoSkip(r: RuleResult): boolean {
  return r.status === "PASS" && r.reason.includes("(SKIP)");
}

function scopeTasksLabel(n: number): string {
  return `${n} ${n === 1 ? "задача" : "задачи"}`;
}

function formatViolations(fail: number, warn: number): { fail: number; warn: number } {
  return { fail, warn };
}

function outcomeFromCounts(
  fail: number,
  warn: number,
  opts: {
    partial?: boolean;
    noCandidates?: boolean;
    skipped?: boolean;
  } = {},
): RegistryOutcome {
  if (opts.skipped) return "SKIP";
  if (opts.noCandidates) return "OK";
  if (fail > 0) return "FAIL";
  if (warn > 0) return "WARN";
  if (opts.partial) return "PARTIAL";
  return "OK";
}

function countByStatus(results: RuleResult[]): {
  skipped: number;
  notApplicable: number;
  pass: number;
  fail: number;
  warn: number;
} {
  let skipped = 0;
  let notApplicable = 0;
  let pass = 0;
  let fail = 0;
  let warn = 0;
  for (const r of results) {
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      skipped++;
      continue;
    }
    if (r.status === "NOT_APPLICABLE") {
      notApplicable++;
      continue;
    }
    if (r.status === "PASS") pass++;
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
  }
  return { skipped, notApplicable, pass, fail, warn };
}

function defaultTaskAccount(
  result: AuditResult,
  ruleId: string,
  opts: {
    zeroCandidatesLabel?: string;
    allCandidatesLabel?: (n: number) => string;
    partial?: boolean;
  } = {},
): RuleCandidateAccount {
  const results = taskResultsForRule(result, ruleId);
  const scope = result.meta.cardsChecked;
  const counts = countByStatus(results);
  const candidates = counts.pass + counts.fail + counts.warn;
  const { fail, warn } = formatViolations(counts.fail, counts.warn);

  if (counts.skipped === results.length && results.length > 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "источник недоступен",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  if (candidates === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: opts.zeroCandidatesLabel ?? "Кандидатов для проверки нет",
      unavailableLabel:
        counts.skipped > 0 ? `${counts.skipped} пропущено (нет источника)` : "—",
      fail,
      warn,
      outcome: outcomeFromCounts(fail, warn, { noCandidates: true }),
    };
  }

  const candidatesLabel =
    fail + warn > 0
      ? `${fail + warn} с нарушениями`
      : opts.allCandidatesLabel?.(candidates) ??
        `${candidates} ${candidates === 1 ? "кандидат" : "кандидатов"} — нарушений нет`;

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel,
    unavailableLabel:
      counts.notApplicable > 0
        ? `${counts.notApplicable} вне области правила`
        : counts.skipped > 0
          ? `${counts.skipped} не проверено (нет источника)`
          : "—",
    fail,
    warn,
    outcome: outcomeFromCounts(fail, warn, { partial: opts.partial }),
  };
}

function scrumPlannedHoursAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const pvResults = taskResultsForRule(result, "scrum_planned_hours_present");
  const estimateResults = taskResultsForRule(result, "scrum_task_in_estimate");

  let skipped = 0;
  let inEstimate = 0;
  let notInEstimate = 0;
  let pvOk = 0;
  let pvWarn = 0;

  for (const r of pvResults) {
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      if (
        r.reason.includes("Нет строки сметы") ||
        r.reason.includes("ПВ не проверялось")
      ) {
        notInEstimate++;
        continue;
      }
      skipped++;
      continue;
    }
    if (r.status === "NOT_APPLICABLE") continue;
    inEstimate++;
    if (r.status === "WARN") pvWarn++;
    else if (r.status === "PASS") pvOk++;
  }

  const notInEstimateWarns = estimateResults.filter(
    (r) =>
      r.status === "WARN" &&
      r.reason.includes("не найдена в утверждённой смете"),
  ).length;
  const missingFromEstimate = Math.max(notInEstimate, notInEstimateWarns);

  const candidates = inEstimate;
  const { fail, warn } = formatViolations(0, pvWarn);

  if (skipped === pvResults.length && pvResults.length > 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "Scrum / смета недоступна",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  if (candidates === 0 && missingFromEstimate === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "Кандидатов для проверки нет",
      unavailableLabel: "—",
      fail,
      warn,
      outcome: "OK",
    };
  }

  const parts: string[] = [];
  if (candidates > 0) parts.push(`${candidates} в Scrum / смете`);
  if (missingFromEstimate > 0) {
    parts.push(`не в смете: ${missingFromEstimate}`);
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel: parts.join("; "),
    unavailableLabel:
      missingFromEstimate > 0
        ? `${missingFromEstimate} без строки сметы (ПВ не проверялось)`
        : "—",
    fail,
    warn,
    outcome:
      pvWarn > 0
        ? "WARN"
        : missingFromEstimate > 0
          ? "PARTIAL"
          : candidates > 0
            ? "OK"
            : "OK",
  };
}

function assigneeAggregateAccount(
  result: AuditResult,
  ruleId: string,
  opts: {
    entityLabel: string;
    zeroLabel: string;
  },
): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const assignees = new Set<string>();
  let violations = 0;

  for (const card of result.cards) {
    const r = card.results.find((x) => x.ruleId === ruleId);
    if (!r || r.status === "SKIP" || isPseudoSkip(r) || r.status === "NOT_APPLICABLE") {
      continue;
    }
    const assignee = card.task.assignees.find((a) => a?.trim());
    if (assignee) assignees.add(assignee.trim());
    if (r.status === "WARN" || r.status === "FAIL") violations++;
  }

  const n = assignees.size;
  if (n === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: opts.zeroLabel,
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel: `${n} ${opts.entityLabel}`,
    unavailableLabel: "—",
    fail: 0,
    warn: violations,
    outcome: violations > 0 ? "WARN" : "OK",
  };
}

function trackingNonWorkAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "tracking_on_non_work_status");
  let skipped = 0;
  let withTracking = 0;
  let warn = 0;

  for (const r of results) {
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      skipped++;
      continue;
    }
    if (r.status === "NOT_APPLICABLE") continue;
    withTracking++;
    if (r.status === "WARN") warn++;
  }

  if (skipped === results.length && results.length > 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "tracking недоступен",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  if (withTracking === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 записей с трекингом за 24 ч",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel: `${withTracking} задач с трекингом за 24 ч`,
    unavailableLabel: "—",
    fail: 0,
    warn,
    outcome: warn > 0 ? "WARN" : "OK",
  };
}

function testerFeedbackProofAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "tester_feedback_has_proof");
  const counts = countByStatus(results);
  const withFeedback = counts.pass + counts.warn + counts.fail;
  const violations = counts.warn + counts.fail;

  if (withFeedback === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 замечаний тестировщика",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      violations > 0
        ? `${violations} замечаний без пруфа`
        : `${withFeedback} замечаний — пруф есть`,
    unavailableLabel: "—",
    fail: counts.fail,
    warn: counts.warn,
    outcome: outcomeFromCounts(counts.fail, counts.warn),
  };
}

function markerRuleAccount(
  result: AuditResult,
  ruleId: string,
  markerName: string,
): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, ruleId);
  const counts = countByStatus(results);
  const markers = counts.fail + counts.warn;

  if (counts.skipped === results.length && results.length > 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "источник недоступен",
      unavailableLabel: "—",
      fail: counts.fail,
      warn: counts.warn,
      outcome: "SKIP",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      markers > 0
        ? `${markers} ${markerName}`
        : `0 найденных ${markerName}`,
    unavailableLabel: "—",
    fail: counts.fail,
    warn: counts.warn,
    outcome: outcomeFromCounts(counts.fail, counts.warn, {
      noCandidates: markers === 0,
    }),
  };
}

function reviewStageAssigneeAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "review_stage_requires_assignee");
  const counts = countByStatus(results);
  const onReview = counts.pass + counts.fail + counts.warn;

  if (onReview === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 задач на проверке / QA",
      unavailableLabel: "—",
      fail: counts.fail,
      warn: counts.warn,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel: `${onReview} на проверке / QA`,
    unavailableLabel:
      counts.notApplicable > 0
        ? `${counts.notApplicable} вне этапа проверки`
        : "—",
    fail: counts.fail,
    warn: counts.warn,
    outcome: outcomeFromCounts(counts.fail, counts.warn),
  };
}

function blockedAssigneeAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "blocked_assignee_not_allowed");
  const counts = countByStatus(results);

  if (counts.skipped > 0 && counts.pass + counts.fail + counts.warn === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "список пользователей недоступен",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  const candidates = counts.pass + counts.fail + counts.warn;
  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      counts.fail > 0
        ? `${counts.fail} на blocked-исполнителях`
        : `${candidates} назначений — blocked не найдено`,
    unavailableLabel:
      counts.skipped > 0 ? `${counts.skipped} пропущено (нет users)` : "—",
    fail: counts.fail,
    warn: counts.warn,
    outcome: outcomeFromCounts(counts.fail, counts.warn),
  };
}

function actReadyAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "act_ready_naming");
  const counts = countByStatus(results);
  const completed = counts.pass + counts.fail + counts.warn;

  if (completed === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 завершённых задач для актов",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "OK",
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel: `${completed} завершённых для актов`,
    unavailableLabel:
      "проверено частично: название; фактическое время и ПВ — отдельные правила",
    fail: counts.fail,
    warn: counts.warn,
    outcome:
      counts.fail > 0
        ? "FAIL"
        : counts.warn > 0
          ? "WARN"
          : "PARTIAL",
  };
}

function neverStartedAccount(result: AuditResult): RuleCandidateAccount {
  const thresholdDays = Number(process.env.NEVER_STARTED_DAYS ?? "14") || 14;
  const account = defaultTaskAccount(result, "never_started_task", {
    zeroCandidatesLabel: `0 задач старше ${thresholdDays} дн. без старта`,
    allCandidatesLabel: (n) => `${n} старше ${thresholdDays} дн. — нарушений нет`,
  });
  account.unavailableLabel =
    account.unavailableLabel === "—"
      ? `порог возраста: ${thresholdDays} дн.`
      : `${account.unavailableLabel}; порог ${thresholdDays} дн.`;
  return account;
}

function teamRoleRateAccount(result: AuditResult): RuleCandidateAccount {
  const wsFindings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === "team_worksheet_match",
  );
  const missingFindings = wsFindings.filter(
    (f) => f.status === "WARN" || f.status === "FAIL",
  );
  const missingInSheet = missingFindings.length;
  const missingLabels = new Set(missingFindings.map((f) => f.objectLabel));

  const roleFindings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === "team_role_rate_match",
  );
  const fail = roleFindings.filter((f) => f.status === "FAIL").length;
  const roleWarnOnly = roleFindings.filter(
    (f) =>
      (f.status === "WARN" || f.status === "FAIL") &&
      !missingLabels.has(f.objectLabel),
  ).length;
  const warn = missingInSheet + roleWarnOnly;

  if (roleFindings.some((f) => f.status === "SKIP")) {
    return {
      scopeLabel: "участники рабочей таблицы",
      candidatesLabel: "рабочая таблица недоступна",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  const checkedInSheet = roleFindings.filter(
    (f) => f.status === "PASS" || f.status === "WARN" || f.status === "FAIL",
  ).length;
  const parts: string[] = [];
  if (checkedInSheet > 0) parts.push(`${checkedInSheet} в таблице`);
  if (missingInSheet > 0) parts.push(`${missingInSheet} не в таблице`);

  return {
    scopeLabel: "исполнители AppTask + рабочая таблица",
    candidatesLabel: parts.length > 0 ? parts.join("; ") : "участники не найдены",
    unavailableLabel: "—",
    fail,
    warn,
    outcome:
      fail > 0
        ? "FAIL"
        : warn > 0
          ? "WARN"
          : checkedInSheet > 0
            ? "OK"
            : "OK",
  };
}

function scrumDecompositionAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "scrum_decomposition_over_20h");
  let candidates = 0;
  let warn = 0;
  let fail = 0;
  let skipped = 0;

  for (const r of results) {
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      skipped++;
      continue;
    }
    if (r.reason.includes("Нет строки сметы")) continue;
    if (r.status === "PASS" && r.reason === "OK") continue;
    candidates++;
    if (r.status === "WARN") warn++;
    if (r.status === "FAIL") fail++;
  }

  if (skipped === results.length && results.length > 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "Scrum / смета недоступна",
      unavailableLabel: "—",
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  if (candidates === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 задач с ПВ >20 ч",
      unavailableLabel: "—",
      fail,
      warn,
      outcome: outcomeFromCounts(fail, warn, { noCandidates: true }),
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      fail + warn > 0
        ? `${fail + warn} с нарушениями`
        : `${candidates} с ПВ >20 ч — нарушений нет`,
    unavailableLabel: "—",
    fail,
    warn,
    outcome: outcomeFromCounts(fail, warn),
  };
}

function deadlineAccount(result: AuditResult): RuleCandidateAccount {
  const scope = result.meta.cardsChecked;
  const results = taskResultsForRule(result, "deadline_less_than_one_day");
  let candidates = 0;
  let fail = 0;
  let warn = 0;

  for (const r of results) {
    if (r.status === "NOT_APPLICABLE") continue;
    if (r.status === "SKIP" || isPseudoSkip(r)) continue;
    if (r.reason.includes("Задача завершена") || r.reason.includes("Нет дедлайна")) continue;
    if (r.status === "PASS" && r.reason === "OK") continue;
    candidates++;
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
  }

  if (candidates === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 задач с дедлайном < 1 дня",
      unavailableLabel: "—",
      fail,
      warn,
      outcome: outcomeFromCounts(fail, warn, { noCandidates: true }),
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      fail + warn > 0
        ? `${fail + warn} с нарушениями`
        : `${candidates} с дедлайном < 1 дня — нарушений нет`,
    unavailableLabel: "—",
    fail,
    warn,
    outcome: outcomeFromCounts(fail, warn),
  };
}

function reviewStaleAccount(result: AuditResult): RuleCandidateAccount {
  const results = taskResultsForRule(result, "review_stale");
  let onReview = 0;
  for (const card of result.cards) {
    if (isTestingStatus(card.task.status)) onReview++;
  }
  const account = defaultTaskAccount(result, "review_stale", {
    zeroCandidatesLabel:
      onReview === 0 ? "0 задач на проверке" : "0 задач на проверке без движения",
  });
  if (onReview > 0 && account.candidatesLabel.includes("Кандидатов")) {
    account.candidatesLabel = `${onReview} на проверке — без нарушений`;
  }
  return account;
}

function linksReachableAccount(result: AuditResult): RuleCandidateAccount {
  const ruleId = "links_reachable";
  const results = taskResultsForRule(result, ruleId);
  const scope = result.meta.cardsChecked;
  const counts = countByStatus(results);
  const { fail, warn } = formatViolations(counts.fail, counts.warn);

  let withLinks = 0;
  for (const card of result.cards) {
    const hasEmptyAttachment = card.task.attachments.some((a) => !a.url?.trim());
    if (collectLinkCheckTargets(card.task).length > 0 || hasEmptyAttachment) {
      withLinks++;
    }
  }

  if (counts.skipped === results.length && results.length > 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "HTTP-проверка отключена",
      unavailableLabel: `${counts.skipped} не проверено (LINK_CHECK_ENABLED=false)`,
      fail: 0,
      warn: 0,
      outcome: "SKIP",
    };
  }

  if (withLinks === 0) {
    return {
      scopeLabel: scopeTasksLabel(scope),
      candidatesLabel: "0 карточек со ссылками для проверки",
      unavailableLabel: counts.skipped > 0 ? `${counts.skipped} пропущено` : "—",
      fail,
      warn,
      outcome: outcomeFromCounts(fail, warn, { noCandidates: true }),
    };
  }

  return {
    scopeLabel: scopeTasksLabel(scope),
    candidatesLabel:
      fail + warn > 0
        ? `${withLinks} со ссылками, ${fail + warn} с проблемами`
        : `${withLinks} со ссылками — все доступны`,
    unavailableLabel:
      counts.skipped > 0 ? `${counts.skipped} пропущено (проверка отключена)` : "—",
    fail,
    warn,
    outcome: outcomeFromCounts(fail, warn, { partial: counts.skipped > 0 }),
  };
}

export function buildRuleCandidateAccount(
  ruleId: string,
  result: AuditResult,
): RuleCandidateAccount {
  switch (ruleId) {
    case "scrum_planned_hours_present":
      return scrumPlannedHoursAccount(result);
    case "review_queue_over_limit": {
      const queue =
        result.meta.boardMetrics?.reviewQueueCount ??
        Object.values(result.meta.boardMetrics?.byBoard ?? {}).reduce(
          (sum, b) => sum + b.testingQueueCount,
          0,
        );
      const results = taskResultsForRule(result, ruleId);
      const counts = countByStatus(results);
      return {
        scopeLabel: "очередь проверки",
        candidatesLabel:
          queue === 0
            ? "0 задач на проверке"
            : `${queue} задач на проверке`,
        unavailableLabel: "—",
        fail: counts.fail,
        warn: counts.warn,
        outcome: outcomeFromCounts(counts.fail, counts.warn, {
          noCandidates: queue === 0,
        }),
      };
    }
    case "high_priority_stale":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 high priority / critical bug",
      });
    case "review_stage_requires_assignee":
      return reviewStageAssigneeAccount(result);
    case "review_stale":
      return reviewStaleAccount(result);
    case "tracking_on_non_work_status":
      return trackingNonWorkAccount(result);
    case "mass_start_without_completion":
      return assigneeAggregateAccount(result, ruleId, {
        entityLabel: "исполнителей с активными задачами",
        zeroLabel: "0 исполнителей в зоне проверки",
      });
    case "developer_active_tasks_limit":
      return assigneeAggregateAccount(result, ruleId, {
        entityLabel: "исполнителей в работе",
        zeroLabel: "0 исполнителей с задачами в работе",
      });
    case "never_started_task":
      return neverStartedAccount(result);
    case "blocked_assignee_not_allowed":
      return blockedAssigneeAccount(result);
    case "act_ready_naming":
      return actReadyAccount(result);
    case "team_role_rate_match":
      return teamRoleRateAccount(result);
    case "vague_done_comment":
      return markerRuleAccount(result, ruleId, "маркеров «готово/сделал/проверь»");
    case "open_questions_closed":
      return markerRuleAccount(result, ruleId, "открытых вопросов");
    case "unresolved_question_keywords_in_card":
      return markerRuleAccount(result, ruleId, "маркеров незакрытого вопроса");
    case "tester_feedback_has_proof":
      return testerFeedbackProofAccount(result);
    case "blocked_tag_present":
    case "blocked_task_reason":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 заблокированных задач",
      });
    case "deadline_less_than_one_day":
      return deadlineAccount(result);
    case "assignee_present":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 активных задач (в работе/на проверке) без исполнителя",
      });
    case "links_reachable":
      return linksReachableAccount(result);
    case "verified_success_comment":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 завершённых без комментария «проверено»",
      });
    case "scrum_decomposition_over_20h":
      return scrumDecompositionAccount(result);
    case "in_progress_stale":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 задач в работе без обновлений",
      });
    case ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE:
      return actualHoursExceedsAccount(result);
    case ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE:
      return estimateOverrunCommentAccount(result);
    case "ui_has_mockup_link":
    case "ui_mockup_approved":
    case "ui_adaptive_requirements":
    case "ui_browser_device_requirements":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 UI/front задач",
        allCandidatesLabel: (n) => `${n} UI/front — нарушений нет`,
      });
    default:
      return defaultTaskAccount(result, ruleId);
  }
}

export function isZeroCandidatesLabel(label: string): boolean {
  const t = label.trim();
  if (/^0\s/.test(t)) return true;
  if (t === "Кандидатов для проверки нет") return true;
  if (t.startsWith("0 high priority")) return true;
  if (t.startsWith("0 задач на проверке")) return true;
  if (t.startsWith("0 исполнителей")) return true;
  if (t.startsWith("0 записей с трекингом")) return true;
  if (t.startsWith("0 найденных")) return true;
  if (t.startsWith("0 заблокированных")) return true;
  if (t.startsWith("0 задач с ПВ")) return true;
  if (t.startsWith("0 задач с превышением")) return true;
  if (t.startsWith("0 задач с фактом")) return true;
  return false;
}
