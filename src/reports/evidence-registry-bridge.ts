import type { ContractCheckRegistryEntry } from "../config/contract-check-registry.js";
import type { AuditResult } from "../rules/rule-types.js";
import type { EvidenceResult } from "../rules/evidence-types.js";
import { buildEvidenceResult } from "./build-evidence-result.js";
import { isZeroCandidatesLabel } from "./rule-candidate-accounting.js";
import type { RegistryOutcome, RegistryTableRow } from "./check-registry-stats.js";

function scopeTasksLabel(n: number): string {
  return `${n} ${n === 1 ? "задача" : "задачи"}`;
}

function formatViolations(fail: number, warn: number): string {
  if (fail === 0 && warn === 0) return "0";
  const parts: string[] = [];
  if (fail > 0) parts.push(`${fail} FAIL`);
  if (warn > 0) parts.push(`${warn} WARN`);
  return parts.join(", ");
}

function countFailWarn(result: AuditResult, ruleId: string): { fail: number; warn: number } {
  let fail = 0;
  let warn = 0;
  for (const card of result.cards) {
    const r = card.results.find((x) => x.ruleId === ruleId);
    if (!r) continue;
    if (r.status === "FAIL") fail++;
    if (r.status === "WARN") warn++;
  }
  for (const f of result.entityFindings ?? result.meta.entityFindings ?? []) {
    if (f.ruleId !== ruleId) continue;
    if (f.status === "FAIL") fail++;
    if (f.status === "WARN") warn++;
  }
  return { fail, warn };
}

function unavailableLabel(evidence: EvidenceResult): string {
  if (evidence.notCheckedCount === 0) return "—";
  const first = evidence.notCheckedEvidence[0]?.reason ?? "";
  if (first.includes("без строки сметы") || first.includes("не найдена в смете")) {
    return `${evidence.notCheckedCount} без строки сметы (ПВ не проверялось)`;
  }
  if (first.includes("роль/ставку") || first.includes("таблице")) {
    return `${evidence.notCheckedCount} без строки в таблице (роль/ставку сверить нельзя)`;
  }
  if (evidence.automationLevel === "SOURCE_UNAVAILABLE") {
    return evidence.notCheckedEvidence[0]?.reason ?? `${evidence.notCheckedCount} не проверено`;
  }
  return `${evidence.notCheckedCount} не проверено`;
}

function candidatesLabel(evidence: EvidenceResult): string {
  if (evidence.summaryLabel?.trim()) return evidence.summaryLabel.trim();
  if (evidence.candidateCount === 0) return "Кандидатов для проверки нет";
  if (evidence.violationCount > 0) {
    return `${evidence.violationCount} с нарушениями`;
  }
  return `${evidence.candidateCount} кандидатов — нарушений нет`;
}

function mapStatus(status: EvidenceResult["status"]): RegistryOutcome {
  return status;
}

/** Построить строку реестра и EvidenceResult из единого источника доказательств. */
export function buildRegistryRowFromEvidence(
  entry: ContractCheckRegistryEntry,
  result: AuditResult,
): RegistryTableRow & { evidence: EvidenceResult } {
  const ruleId = entry.ruleIds[0]!;
  const evidence = buildEvidenceResult(ruleId, result);
  const { fail, warn } = countFailWarn(result, ruleId);

  const checked =
    entry.scope === "entity" || entry.scope === "board"
      ? evidence.sources.join("; ") || "1 объект"
      : scopeTasksLabel(result.meta.cardsChecked);

  return {
    entry,
    checked,
    candidates: candidatesLabel(evidence),
    unavailable: unavailableLabel(evidence),
    violations: formatViolations(fail, warn),
    outcome: mapStatus(evidence.status),
    evidence,
  };
}

export function registryHasZeroCandidatesFromEvidence(evidence: EvidenceResult): boolean {
  return (
    evidence.candidateCount === 0 ||
    isZeroCandidatesLabel(evidence.summaryLabel ?? "")
  );
}
