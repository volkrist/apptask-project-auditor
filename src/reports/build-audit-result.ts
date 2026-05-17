import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";
import { evaluateProject } from "../rules/evaluate.js";
import type { AuditResult, RuleStatus } from "../rules/rule-types.js";
import { ruleLabel } from "./rule-labels.js";

export type AuditMetaInput = {
  projectName: string;
  boardUrl: string;
  auditedAt?: string;
};

/** Агрегирует FAIL/WARN по ruleId (только нарушения). */
export function buildTopIssues(
  result: Pick<AuditResult, "cards">,
  limit = 7,
): AuditResult["topIssues"] {
  const counts = new Map<string, { fail: number; warn: number }>();

  for (const card of result.cards) {
    for (const r of card.results) {
      if (r.status === "PASS") continue;
      const entry = counts.get(r.ruleId) ?? { fail: 0, warn: 0 };
      if (r.status === "FAIL") entry.fail++;
      if (r.status === "WARN") entry.warn++;
      counts.set(r.ruleId, entry);
    }
  }

  const ranked = [...counts.entries()]
    .map(([ruleId, c]) => ({
      ruleId,
      label: ruleLabel(ruleId),
      count: c.fail + c.warn,
      fail: c.fail,
      warn: c.warn,
    }))
    .sort((a, b) => b.count - a.count || b.fail - a.fail);

  return ranked.slice(0, limit).map(({ ruleId, label, count }) => ({
    ruleId,
    label,
    count,
  }));
}

/** Сборка AuditResult из сырых карточек и конфига правил. */
export async function buildAuditResult(
  tasks: RawTask[],
  config: AuditConfig,
  meta: AuditMetaInput,
): Promise<AuditResult> {
  const project = await evaluateProject(tasks, config);
  const base: AuditResult = {
    meta: {
      projectName: meta.projectName,
      boardUrl: meta.boardUrl,
      auditedAt: meta.auditedAt ?? new Date().toISOString(),
      cardsChecked: tasks.length,
      failCount: project.failCount,
      warnCount: project.warnCount,
    },
    topIssues: [],
    cards: project.cards,
  };
  return { ...base, topIssues: buildTopIssues(base) };
}

export function countByStatus(
  result: Pick<AuditResult, "cards">,
  status: RuleStatus,
): number {
  let total = 0;
  for (const card of result.cards) {
    for (const r of card.results) {
      if (r.status === status) total++;
    }
  }
  return total;
}
