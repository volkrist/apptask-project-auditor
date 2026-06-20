import {
  CONTRACT_CHECK_REGISTRY,
  type ContractCheckRegistryEntry,
} from "../config/contract-check-registry.js";
import { getAuditProfile } from "../config/audit-profiles.js";
import { isEntityRule } from "../rules/rule-scopes.js";
import type { AuditResult, RuleResult } from "../rules/rule-types.js";
import {
  buildBoardClassification,
  formatClassificationSummaryLine,
} from "./board-classification.js";
import {
  isTeamDiscordSkipped,
  describeTeamCompositeRegistry,
} from "./team-check-composite.js";
import { escapeTableCell } from "./report-links.js";
import {
  buildRuleCandidateAccount,
  isZeroCandidatesLabel,
} from "./rule-candidate-accounting.js";
import { isSourceMissingSkip } from "./report-presentation.js";

export type RegistryOutcome =
  | "OK"
  | "FAIL"
  | "WARN"
  | "SKIP"
  | "PARTIAL"
  | "NOT_APPLICABLE";

export type RegistryTableRow = {
  entry: ContractCheckRegistryEntry;
  checked: string;
  candidates: string;
  unavailable: string;
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

export function getTaskRuleStats(
  result: AuditResult,
  ruleId: string,
): TaskRuleStats {
  return computeTaskRuleStats(result, ruleId);
}

/** Кандидатов нет — не показывать ложное «все прошли». */
export function registryHasZeroCandidates(row: RegistryTableRow): boolean {
  return isZeroCandidatesLabel(row.candidates);
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

function describeEntityRow(
  ruleId: string,
  result: AuditResult,
): Omit<RegistryTableRow, "entry"> | null {
  if (ruleId === "team_role_rate_match") {
    const account = buildRuleCandidateAccount(ruleId, result);
    return {
      checked: account.scopeLabel,
      candidates: account.candidatesLabel,
      unavailable: account.unavailableLabel,
      violations: formatViolations(account.fail, account.warn),
      outcome: account.outcome,
    };
  }

  const findings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === ruleId,
  );

  if (
    findings.some((f) => f.status === "SKIP") &&
    ruleId !== "team_discord_match"
  ) {
    return {
      checked: "—",
      candidates: "—",
      unavailable: "—",
      violations: "—",
      outcome: "SKIP",
    };
  }

  const fail = findings.filter((f) => f.status === "FAIL").length;
  const warn = findings.filter((f) => f.status === "WARN").length;
  const total = result.meta.totalTasksOnBoard ?? result.meta.cardsChecked;

  switch (ruleId) {
    case "task_type_classification": {
      const { counts } = buildBoardClassification(result);
      return {
        checked: `${counts.total} карточек`,
        candidates: `классифицировано: ${formatClassificationSummaryLine(counts)}`,
        unavailable: "—",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    }
    case "tracking_daily_anomaly": {
      const rows = findings.flatMap((f) => f.trackingRows ?? []);
      return {
        checked: "учёт времени по дням",
        candidates: `${rows.length} случаев > лимита`,
        unavailable: "—",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    }
    case "sprint_dates_match":
      return {
        checked: "майлстоуны рабочей таблицы",
        candidates: `${warn} спринтов без дат`,
        unavailable: "—",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    case "team_worksheet_match":
      return {
        checked: "исполнители AppTask + рабочая таблица",
        candidates:
          warn > 0 ? `${warn} участников не в таблице` : "состав сверен",
        unavailable: "—",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    case "team_discord_match": {
      const skipped = findings.every((f) => f.status === "SKIP");
      if (skipped) {
        return {
          checked: "—",
          candidates: "нет доступа к списку участников сервера",
          unavailable: "—",
          violations: "—",
          outcome: "SKIP",
        };
      }
      return {
        checked: "исполнители AppTask + Discord",
        candidates:
          warn > 0 ? `${warn} участников не в Discord` : "состав сверен",
        unavailable: "—",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    }
    case "project_worksheet_match":
      return {
        checked: "доска + рабочая таблица",
        candidates: warn > 0 ? `${warn} расхождений` : "данные сверены",
        unavailable: "—",
        violations: formatViolations(fail, warn),
        outcome: outcomeFrom("CHECKED", fail, warn),
      };
    default:
      return {
        checked: findings.length > 0 ? "1 объект" : "доска",
        candidates: warn + fail > 0 ? `${warn + fail} нарушений` : "соответствует",
        unavailable: "—",
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
      unavailable: "—",
      violations: "—",
      outcome: "NOT_APPLICABLE",
    };
  }

  if (ruleId === "team_worksheet_match") {
    const wsEntity = describeEntityRow("team_worksheet_match", result) ?? {
      checked: "—",
      candidates: "—",
      unavailable: "—",
      violations: "—",
      outcome: "SKIP" as RegistryOutcome,
    };
    return {
      entry,
      ...describeTeamCompositeRegistry(result, wsEntity),
    };
  }

  if (isRuleSkipped(result, ruleId)) {
    if (isEntityRule(ruleId)) {
      const entity = describeEntityRow(ruleId, result);
      if (entity) return { entry, ...entity };
    }
    return {
      entry,
      checked: "—",
      candidates: "источник недоступен",
      unavailable: "—",
      violations: "—",
      outcome: "SKIP",
    };
  }

  if (isEntityRule(ruleId)) {
    const entity = describeEntityRow(ruleId, result);
    if (entity) return { entry, ...entity };
  }

  const account = buildRuleCandidateAccount(ruleId, result);
  return {
    entry,
    checked: account.scopeLabel,
    candidates: account.candidatesLabel,
    unavailable: account.unavailableLabel,
    violations: formatViolations(account.fail, account.warn),
    outcome: account.outcome,
  };
}

export function buildRegistryTableRows(result: AuditResult): RegistryTableRow[] {
  return CONTRACT_CHECK_REGISTRY.map((entry) => buildRegistryRow(entry, result));
}

export function summarizeRegistryOutcomes(
  rows: RegistryTableRow[],
  result?: AuditResult,
): {
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
  if (result && isTeamDiscordSkipped(result)) {
    skip += 1;
  }
  return { checked, notApplicable, skip };
}

export function formatCheckRegistryMarkdown(result: AuditResult): string[] {
  const rows = buildRegistryTableRows(result);
  const summary = summarizeRegistryOutcomes(rows, result);

  const lines: string[] = [
    "## Реестр выполненных проверок",
    "",
    `- CHECKED: ${summary.checked}`,
    `- NOT_APPLICABLE: ${summary.notApplicable}`,
    `- SKIP: ${summary.skip}`,
    "",
    "| № | Проверка | Область | Проверено | Кандидатов | Не проверено | Нарушения | Итог |",
    "| - | -------- | ------- | --------- | ---------- | ------------ | --------- | ---- |",
  ];

  for (const row of rows) {
    const { entry } = row;
    lines.push(
      `| ${entry.num} | ${escapeTableCell(entry.title)} | ${entry.scope} | ${escapeTableCell(row.checked)} | ${escapeTableCell(row.candidates)} | ${escapeTableCell(row.unavailable)} | ${escapeTableCell(row.violations)} | ${row.outcome} |`,
    );
  }

  lines.push("");
  return lines;
}

// Re-export for tests
export { isRuleSkipped as isRegistryRuleSkipped };
