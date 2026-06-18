import {
  CONTRACT_CHECK_REGISTRY,
  type ContractCheckRegistryEntry,
} from "../config/contract-check-registry.js";
import { getAuditProfile } from "../config/audit-profiles.js";
import { isEntityRule } from "../rules/rule-scopes.js";
import type { AuditResult, RuleResult } from "../rules/rule-types.js";
import { escapeTableCell } from "./report-links.js";
import {
  isSourceMissingSkip,
  type SkipRuleSummary,
} from "./report-presentation.js";

export type RegistryOutcome = "OK" | "FAIL" | "WARN" | "SKIP" | "NOT_APPLICABLE";

export type RegistryTableRow = {
  entry: ContractCheckRegistryEntry;
  checked: string;
  candidates: string;
  violations: string;
  outcome: RegistryOutcome;
};

type TaskRuleStats = {
  total: number;
  skipped: number;
  notApplicable: number;
  applicable: number;
  pass: number;
  fail: number;
  warn: number;
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

function computeTaskRuleStats(result: AuditResult, ruleId: string): TaskRuleStats {
  const all = taskResultsForRule(result, ruleId);
  const total = result.meta.cardsChecked;
  let skipped = 0;
  let notApplicable = 0;
  let applicable = 0;
  let pass = 0;
  let fail = 0;
  let warn = 0;

  for (const r of all) {
    if (r.status === "SKIP" || isPseudoSkip(r)) {
      skipped++;
      continue;
    }
    if (r.status === "NOT_APPLICABLE") {
      notApplicable++;
      continue;
    }
    applicable++;
    if (r.status === "PASS") pass++;
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
  }

  return { total, skipped, notApplicable, applicable, pass, fail, warn };
}

function isRuleSkipped(result: AuditResult, ruleId: string): boolean {
  const summary = result.meta.skipRuleSummaries?.find((s) => s.ruleId === ruleId);
  if (summary && isSourceMissingSkip(summary)) return true;

  if (isEntityRule(ruleId)) {
    const findings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
      (f) => f.ruleId === ruleId,
    );
    if (findings.length === 0) return false;
    return findings.every((f) => f.status === "SKIP");
  }

  const stats = computeTaskRuleStats(result, ruleId);
  if (stats.skipped === stats.total && stats.total > 0) return true;
  return false;
}

function isRuleInProfile(result: AuditResult, ruleId: string): boolean {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  const profile = getAuditProfile(profileId);
  if (profile.id === "legacy_generic") return true;
  return profile.ruleIds.has(ruleId);
}

function formatViolations(fail: number, warn: number): string {
  if (fail === 0 && warn === 0) return "0";
  const parts: string[] = [];
  if (fail > 0) parts.push(`${fail} FAIL`);
  if (warn > 0) parts.push(`${warn} WARN`);
  return parts.join(", ");
}

function outcomeFrom(
  status: "CHECKED" | "SKIP" | "NOT_APPLICABLE",
  fail: number,
  warn: number,
): RegistryOutcome {
  if (status === "SKIP") return "SKIP";
  if (status === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (fail > 0) return "FAIL";
  if (warn > 0) return "WARN";
  return "OK";
}

function countBlockedTaskCandidates(result: AuditResult, ruleId: string): number {
  return taskResultsForRule(result, ruleId).filter(
    (r) =>
      r.status !== "SKIP" &&
      r.status !== "NOT_APPLICABLE" &&
      !r.reason.includes("не заблокирована"),
  ).length;
}

function describeTaskCandidates(
  ruleId: string,
  s: TaskRuleStats,
  result: AuditResult,
): string {
  const v = s.fail + s.warn;
  switch (ruleId) {
    case "blocked_tag_present":
    case "blocked_task_reason": {
      const blocked = countBlockedTaskCandidates(result, ruleId);
      return blocked === 0 ? "0 заблокированных задач" : `${blocked} заблокированных задач`;
    }
    case "deadline_less_than_one_day":
      return v > 0
        ? `${v} задач с дедлайном < 1 дня`
        : "0 задач с дедлайном < 1 дня";
    case "assignee_present":
      return v > 0 ? `${v} карточек без исполнителя` : "0 карточек без исполнителя";
    case "verified_success_comment":
      return v > 0
        ? `${v} завершённых без комментария «проверено»`
        : "0 завершённых без комментария «проверено»";
    case "open_questions_closed":
      return v > 0
        ? `${v} карточек с открытым вопросом в комментариях`
        : "0 открытых вопросов без ответа";
    case "scrum_decomposition_over_20h":
      return v > 0 ? `${v} задач с ПВ >20 ч без декомпозиции` : "0 задач с ПВ >20 ч";
    case "review_queue_over_limit": {
      const queue =
        result.meta.boardMetrics?.reviewQueueCount ??
        Object.values(result.meta.boardMetrics?.byBoard ?? {}).reduce(
          (sum, b) => sum + b.testingQueueCount,
          0,
        );
      return `${queue} задач на проверке`;
    }
    case "developer_active_tasks_limit":
      return v > 0
        ? `${v} исполнителей с >3 активными задачами`
        : "0 исполнителей сверх лимита";
    case "in_progress_stale":
      return v > 0 ? `${v} задач в работе без обновлений` : "0 задач без обновлений";
    case "review_stale":
      return v > 0 ? `${v} задач на проверке без движения` : "0 задач на проверке";
    case "vague_done_comment":
      return v > 0 ? `${v} коротких done-комментариев` : "0 коротких done-комментариев";
    case "ui_has_mockup_link":
    case "ui_mockup_approved":
    case "ui_adaptive_requirements":
    case "ui_browser_device_requirements":
      return s.applicable === 0
        ? "0 UI/front задач"
        : v > 0
          ? `${v} UI/front с нарушением`
          : `${s.applicable} UI/front — все прошли`;
    default:
      if (v > 0) return `${v} с нарушениями`;
      if (s.applicable === 0) return "0 в области правила";
      return `${s.applicable} в области — все прошли`;
  }
}

function describeEntityRow(
  ruleId: string,
  result: AuditResult,
): Omit<RegistryTableRow, "entry"> | null {
  const findings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === ruleId,
  );

  if (findings.some((f) => f.status === "SKIP")) {
    return {
      checked: "—",
      candidates: "—",
      violations: "—",
      outcome: "SKIP",
    };
  }

  const fail = findings.filter((f) => f.status === "FAIL").length;
  const warn = findings.filter((f) => f.status === "WARN").length;
  const total = result.meta.totalTasksOnBoard ?? result.meta.cardsChecked;

  switch (ruleId) {
    case "task_type_classification": {
      const detail = findings[0]?.details ?? [];
      const flow = detail.find((d) => d.includes("потоковые"))?.match(/:\s*(\d+)/)?.[1] ?? "?";
      const ui = detail.find((d) => d.includes("UI / front"))?.match(/:\s*(\d+)/)?.[1] ?? "?";
      const regular = detail.find((d) => d.includes("обычные"))?.match(/:\s*(\d+)/)?.[1] ?? "?";
      const unknown = detail.find((d) => d.includes("не удалось"))?.match(/:\s*(\d+)/)?.[1] ?? "0";
      return {
        checked: `${total} карточек`,
        candidates: `классифицировано: потоковые ${flow}, UI ${ui}, обычные ${regular}, неизвестно ${unknown}`,
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    }
    case "tracking_daily_anomaly": {
      const rows = findings.flatMap((f) => f.trackingRows ?? []);
      return {
        checked: "учёт времени по дням",
        candidates: `${rows.length} случаев > лимита`,
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    }
    case "sprint_dates_match":
      return {
        checked: "майлстоуны рабочей таблицы",
        candidates: `${warn} спринтов без дат`,
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    case "team_worksheet_match":
      return {
        checked: `${result.meta.cardsChecked} задач / исполнители`,
        candidates: `${warn} участников не в таблице`,
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    case "team_role_rate_match":
      return {
        checked: "участники рабочей таблицы",
        candidates: warn > 0 ? `${warn} без роли/ставки` : "роли и ставки заполнены",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    case "project_worksheet_match":
      return {
        checked: "доска + рабочая таблица",
        candidates: warn > 0 ? `${warn} расхождений` : "данные сверены",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    default:
      return {
        checked: findings.length > 0 ? "1 объект" : "доска",
        candidates: warn + fail > 0 ? `${warn + fail} нарушений` : "соответствует",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
  }
}

function buildRegistryRow(
  entry: ContractCheckRegistryEntry,
  result: AuditResult,
): RegistryTableRow {
  const ruleId = entry.ruleIds[0]!;

  if (!isRuleInProfile(result, ruleId)) {
    return {
      entry,
      checked: "—",
      candidates: "—",
      violations: "—",
      outcome: "NOT_APPLICABLE",
    };
  }

  if (isRuleSkipped(result, ruleId)) {
    return {
      entry,
      checked: "—",
      candidates: "источник недоступен",
      violations: "—",
      outcome: "SKIP",
    };
  }

  if (isEntityRule(ruleId)) {
    const entity = describeEntityRow(ruleId, result);
    if (entity) return { entry, ...entity };
  }

  const s = computeTaskRuleStats(result, ruleId);
  const checkedLabel =
    ruleId === "review_queue_over_limit"
      ? "очередь проверки"
      : s.skipped === s.total
        ? "—"
        : `${s.total - s.skipped} ${s.total - s.skipped === 1 ? "задача" : "задачи"}`;

  return {
    entry,
    checked: checkedLabel,
    candidates: describeTaskCandidates(ruleId, s, result),
    violations: formatViolations(s.fail, s.warn),
    outcome: outcomeFrom("CHECKED", s.fail, s.warn),
  };
}

export function buildRegistryTableRows(result: AuditResult): RegistryTableRow[] {
  return CONTRACT_CHECK_REGISTRY.map((entry) => buildRegistryRow(entry, result));
}

export function summarizeRegistryOutcomes(rows: RegistryTableRow[]): {
  checked: number;
  notApplicable: number;
  skip: number;
} {
  let checked = 0;
  let notApplicable = 0;
  let skip = 0;
  for (const row of rows) {
    if (row.outcome === "NOT_APPLICABLE") notApplicable++;
    else if (row.outcome === "SKIP") skip++;
    else checked++;
  }
  return { checked, notApplicable, skip };
}

export function formatCheckRegistryMarkdown(result: AuditResult): string[] {
  const rows = buildRegistryTableRows(result);
  const summary = summarizeRegistryOutcomes(rows);

  const lines: string[] = [
    "## Реестр выполненных проверок",
    "",
    `- CHECKED: ${summary.checked}`,
    `- NOT_APPLICABLE: ${summary.notApplicable}`,
    `- SKIP: ${summary.skip}`,
    "",
    "| № | Проверка | Область | Проверено | Кандидатов | Нарушения | Итог |",
    "| - | -------- | ------- | --------- | ---------- | --------- | ---- |",
  ];

  for (const row of rows) {
    const { entry } = row;
    lines.push(
      `| ${entry.num} | ${escapeTableCell(entry.title)} | ${entry.scope} | ${escapeTableCell(row.checked)} | ${escapeTableCell(row.candidates)} | ${escapeTableCell(row.violations)} | ${row.outcome} |`,
    );
  }

  lines.push("");
  return lines;
}

// Re-export for tests
export { isRuleSkipped as isRegistryRuleSkipped };
