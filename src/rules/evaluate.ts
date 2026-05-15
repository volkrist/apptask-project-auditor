import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";
import { allRules } from "./registry.js";
import type {
  AuditResult,
  CardAudit,
  ProjectEvaluation,
  RuleContext,
  RuleResult,
} from "./rule-types.js";

function buildContext(
  config: AuditConfig,
  allTasks: RawTask[],
): RuleContext {
  return { config, allTasks };
}

function countStatuses(results: RuleResult[]): {
  failCount: number;
  warnCount: number;
} {
  let failCount = 0;
  let warnCount = 0;
  for (const r of results) {
    if (r.status === "FAIL") failCount++;
    if (r.status === "WARN") warnCount++;
  }
  return { failCount, warnCount };
}

/** Оценка одной карточки по всем правилам. */
export function evaluateTask(
  rawTask: RawTask,
  config: AuditConfig,
  allTasks: RawTask[] = [],
): RuleResult[] {
  const ctx = buildContext(config, allTasks.length > 0 ? allTasks : [rawTask]);
  return allRules.map((rule) => rule.evaluate(rawTask, ctx));
}

/** Оценка всех карточек доски. */
export function evaluateProject(
  tasks: RawTask[],
  config: AuditConfig,
): ProjectEvaluation {
  const ctx = buildContext(config, tasks);
  const cards: CardAudit[] = tasks.map((task) => ({
    task,
    results: allRules.map((rule) => rule.evaluate(task, ctx)),
  }));

  let failCount = 0;
  let warnCount = 0;
  for (const card of cards) {
    const counts = countStatuses(card.results);
    failCount += counts.failCount;
    warnCount += counts.warnCount;
  }

  return { cards, failCount, warnCount };
}

/** @deprecated Используйте evaluateTask. */
export function evaluateCard(
  task: RawTask,
  allTasks: RawTask[],
  config: AuditConfig,
): RuleResult[] {
  return evaluateTask(task, config, allTasks);
}

/** Сборка AuditResult для отчётов (meta задаёт вызывающий код). */
export function evaluateBoard(
  tasks: RawTask[],
  config: AuditConfig,
  meta: AuditResult["meta"],
): AuditResult {
  const project = evaluateProject(tasks, config);
  return {
    meta: {
      ...meta,
      cardsChecked: tasks.length,
      failCount: project.failCount,
      warnCount: project.warnCount,
    },
    topIssues: [],
    cards: project.cards,
  };
}
