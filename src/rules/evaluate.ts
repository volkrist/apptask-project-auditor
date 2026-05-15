import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";
import { allRules } from "./registry.js";
import type { AuditResult, CardAudit, RuleResult } from "./rule-types.js";

export function evaluateCard(
  task: RawTask,
  allTasks: RawTask[],
  config: AuditConfig,
): RuleResult[] {
  const ctx = { config, allTasks };
  return allRules.map((rule) => rule.evaluate(task, ctx));
}

export function evaluateBoard(
  tasks: RawTask[],
  config: AuditConfig,
  meta: AuditResult["meta"],
): AuditResult {
  const cards: CardAudit[] = tasks.map((task) => ({
    task,
    results: evaluateCard(task, tasks, config),
  }));

  let failCount = 0;
  let warnCount = 0;
  for (const card of cards) {
    for (const r of card.results) {
      if (r.status === "FAIL") failCount++;
      if (r.status === "WARN") warnCount++;
    }
  }

  return {
    meta: { ...meta, cardsChecked: tasks.length, failCount, warnCount },
    topIssues: [],
    cards,
  };
}
