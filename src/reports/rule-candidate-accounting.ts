import type { AuditResult, RuleResult } from "../rules/rule-types.js";
import { isTestingStatus } from "../rules/status/status-helpers.js";
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
    candidatesLabel: `${candidates} назначений проверено`,
    unavailableLabel:
      "источник «уволенные/неактивные» не подключён — только blocked users AppTask",
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
  const missingInSheet = wsFindings.filter(
    (f) => f.status === "WARN" || f.status === "FAIL",
  ).length;

  const roleFindings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === "team_role_rate_match",
  );
  const fail = roleFindings.filter((f) => f.status === "FAIL").length;
  const warn =
    roleFindings.filter((f) => f.status === "WARN").length + missingInSheet;

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
    unavailableLabel:
      missingInSheet > 0
        ? `${missingInSheet} без строки в таблице (роль/ставку сверить нельзя)`
        : "—",
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
      return markerRuleAccount(result, ruleId, "замечаний тестировщика");
    case "blocked_tag_present":
    case "blocked_task_reason":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 заблокированных задач",
      });
    case "deadline_less_than_one_day":
      return deadlineAccount(result);
    case "assignee_present":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 карточек без исполнителя",
      });
    case "verified_success_comment":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 завершённых без комментария «проверено»",
      });
    case "scrum_decomposition_over_20h":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 задач с ПВ >20 ч",
      });
    case "in_progress_stale":
      return defaultTaskAccount(result, ruleId, {
        zeroCandidatesLabel: "0 задач в работе без обновлений",
      });
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
  if (t.startsWith("0 завершённых")) return true;
  return false;
}
