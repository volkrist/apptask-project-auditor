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

async function runRule(
  rule: (typeof allRules)[number],
  task: RawTask,
  ctx: RuleContext,
): Promise<RuleResult> {
  return Promise.resolve(rule.evaluate(task, ctx));
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
export async function evaluateTask(
  rawTask: RawTask,
  config: AuditConfig,
  allTasks: RawTask[] = [],
): Promise<RuleResult[]> {
  const ctx = buildContext(config, allTasks.length > 0 ? allTasks : [rawTask]);
  return Promise.all(allRules.map((rule) => runRule(rule, rawTask, ctx)));
}

/** Оценка всех карточек доски. */
export async function evaluateProject(
  tasks: RawTask[],
  config: AuditConfig,
): Promise<ProjectEvaluation> {
  const ctx = buildContext(config, tasks);
  const cards: CardAudit[] = await Promise.all(
    tasks.map(async (task) => ({
      task,
      results: await Promise.all(
        allRules.map((rule) => runRule(rule, task, ctx)),
      ),
    })),
  );

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
export async function evaluateCard(
  task: RawTask,
  allTasks: RawTask[],
  config: AuditConfig,
): Promise<RuleResult[]> {
  return evaluateTask(task, config, allTasks);
}

/** Сборка AuditResult для отчётов (meta задаёт вызывающий код). */
export async function evaluateBoard(
  tasks: RawTask[],
  config: AuditConfig,
  meta: AuditResult["meta"],
): Promise<AuditResult> {
  const project = await evaluateProject(tasks, config);
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
