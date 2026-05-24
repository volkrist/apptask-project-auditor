import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";
import type { AppTaskUser } from "../users/app-task-users.js";
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
  appTaskUsers?: AppTaskUser[],
): RuleContext {
  return { config, allTasks, appTaskUsers };
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
  appTaskUsers?: AppTaskUser[],
): Promise<RuleResult[]> {
  const ctx = buildContext(
    config,
    allTasks.length > 0 ? allTasks : [rawTask],
    appTaskUsers,
  );
  return Promise.all(allRules.map((rule) => runRule(rule, rawTask, ctx)));
}

/** Оценка всех карточек доски. */
export async function evaluateProject(
  tasks: RawTask[],
  config: AuditConfig,
  appTaskUsers?: AppTaskUser[],
): Promise<ProjectEvaluation> {
  const ctx = buildContext(config, tasks, appTaskUsers);
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
  appTaskUsers?: AppTaskUser[],
): Promise<RuleResult[]> {
  return evaluateTask(task, config, allTasks, appTaskUsers);
}

/** Сборка AuditResult для отчётов (meta задаёт вызывающий код). */
export async function evaluateBoard(
  tasks: RawTask[],
  config: AuditConfig,
  meta: AuditResult["meta"],
  appTaskUsers?: AppTaskUser[],
): Promise<AuditResult> {
  const project = await evaluateProject(tasks, config, appTaskUsers);
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
