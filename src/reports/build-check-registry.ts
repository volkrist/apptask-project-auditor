import {
  CONTRACT_CHECK_REGISTRY,
  type ContractCheckRegistryEntry,
} from "../config/contract-check-registry.js";
import { getAuditProfile } from "../config/audit-profiles.js";
import { isEntityRule } from "../rules/rule-scopes.js";
import type { AuditResult, RuleResult } from "../rules/rule-types.js";
import {
  isSourceMissingSkip,
  type SkipRuleSummary,
} from "./report-presentation.js";

export type CheckExecutionStatus = "CHECKED" | "NOT_APPLICABLE" | "SKIP";

export type CheckRegistryRow = {
  entry: ContractCheckRegistryEntry;
  executionStatus: CheckExecutionStatus;
  failCount: number;
  warnCount: number;
  resultText: string;
};

function taskResultsForRule(
  result: AuditResult,
  ruleId: string,
): RuleResult[] {
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

function skipSummaryForRule(
  summaries: SkipRuleSummary[] | undefined,
  ruleId: string,
): SkipRuleSummary | undefined {
  return summaries?.find((s) => s.ruleId === ruleId);
}

function countTaskViolations(
  result: AuditResult,
  ruleId: string,
): { fail: number; warn: number } {
  let fail = 0;
  let warn = 0;
  for (const r of taskResultsForRule(result, ruleId)) {
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
  }
  return { fail, warn };
}

function countEntityViolations(
  result: AuditResult,
  ruleId: string,
): { fail: number; warn: number } {
  const findings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
    (f) => f.ruleId === ruleId,
  );
  return {
    fail: findings.filter((f) => f.status === "FAIL").length,
    warn: findings.filter((f) => f.status === "WARN").length,
  };
}

function isRuleSkipped(result: AuditResult, ruleId: string): boolean {
  const summary = skipSummaryForRule(result.meta.skipRuleSummaries, ruleId);
  if (summary && isSourceMissingSkip(summary)) return true;

  if (isEntityRule(ruleId)) {
    const findings = (result.entityFindings ?? result.meta.entityFindings ?? []).filter(
      (f) => f.ruleId === ruleId,
    );
    if (findings.length === 0) return false;
    return findings.every((f) => f.status === "SKIP");
  }

  const taskResults = taskResultsForRule(result, ruleId);
  if (taskResults.length === 0) return false;
  if (taskResults.every((r) => r.status === "SKIP")) return true;
  if (taskResults.every((r) => isPseudoSkip(r))) return true;
  return false;
}

function isRuleInActiveProfile(
  result: AuditResult,
  ruleId: string,
): boolean {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  const profile = getAuditProfile(profileId);
  if (profile.id === "legacy_generic") return true;
  return profile.ruleIds.has(ruleId);
}

function resolveExecutionStatus(
  result: AuditResult,
  entry: ContractCheckRegistryEntry,
): CheckExecutionStatus {
  if (!entry.ruleIds.length) {
    return "NOT_APPLICABLE";
  }

  for (const ruleId of entry.ruleIds) {
    if (!isRuleInActiveProfile(result, ruleId)) {
      return "NOT_APPLICABLE";
    }
    if (isRuleSkipped(result, ruleId)) {
      return "SKIP";
    }
  }

  return "CHECKED";
}

function formatResultText(
  status: CheckExecutionStatus,
  fail: number,
  warn: number,
): string {
  if (status === "NOT_APPLICABLE") return "не применяется";
  if (status === "SKIP") return "SKIP";
  const parts: string[] = [];
  if (fail > 0) parts.push(`FAIL ${fail}`);
  if (warn > 0) parts.push(`WARN ${warn}`);
  if (parts.length === 0) return "выполнено, нарушений: 0";
  return parts.join(", ");
}

function countViolationsForEntry(
  result: AuditResult,
  entry: ContractCheckRegistryEntry,
): { fail: number; warn: number } {
  if (!entry.ruleIds?.length) return { fail: 0, warn: 0 };

  let fail = 0;
  let warn = 0;
  for (const ruleId of entry.ruleIds) {
    if (isEntityRule(ruleId)) {
      const c = countEntityViolations(result, ruleId);
      fail += c.fail;
      warn += c.warn;
    } else {
      const c = countTaskViolations(result, ruleId);
      fail += c.fail;
      warn += c.warn;
    }
  }
  return { fail, warn };
}

export function buildCheckRegistryRows(result: AuditResult): CheckRegistryRow[] {
  return CONTRACT_CHECK_REGISTRY.map((entry) => {
    const executionStatus = resolveExecutionStatus(result, entry);
    const { fail, warn } =
      executionStatus === "CHECKED"
        ? countViolationsForEntry(result, entry)
        : { fail: 0, warn: 0 };
    return {
      entry,
      executionStatus,
      failCount: fail,
      warnCount: warn,
      resultText: formatResultText(executionStatus, fail, warn),
    };
  });
}

export function summarizeCheckRegistry(rows: CheckRegistryRow[]): {
  checked: number;
  notApplicable: number;
  skip: number;
} {
  let checked = 0;
  let notApplicable = 0;
  let skip = 0;
  for (const row of rows) {
    if (row.executionStatus === "CHECKED") checked++;
    if (row.executionStatus === "NOT_APPLICABLE") notApplicable++;
    if (row.executionStatus === "SKIP") skip++;
  }
  return { checked, notApplicable, skip };
}

export function formatCheckRegistryMarkdown(result: AuditResult): string[] {
  const rows = buildCheckRegistryRows(result);
  const summary = summarizeCheckRegistry(rows);
  const lines: string[] = [
    "## Реестр выполненных проверок",
    "",
    `- CHECKED: ${summary.checked}`,
    `- NOT_APPLICABLE: ${summary.notApplicable}`,
    `- SKIP: ${summary.skip}`,
    "",
  ];

  for (const row of rows) {
    const { entry } = row;
    lines.push(
      `### ${entry.num}. ${entry.title}`,
      "",
      `- Название проверки: ${entry.title}`,
      `- Область: ${entry.scope}`,
      `- Статус выполнения: ${row.executionStatus}`,
      `- Результат: ${row.resultText}`,
      "",
    );
  }

  return lines;
}
