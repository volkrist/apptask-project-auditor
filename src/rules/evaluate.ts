import type { AuditConfig } from "../config/audit-config.js";
import {
  getAuditProfile,
  isRuleInProfile,
  resolveAuditProfileId,
} from "../config/audit-profiles.js";
import type { RawTask } from "../adapters/apptask/types.js";
import type { AppTaskUser } from "../users/app-task-users.js";
import type {
  BoardAuditMetrics,
  ScrumAuditContext,
} from "../scrum/scrum-estimate-config.js";
import type { TrackingAuditContext } from "../tracking/load-tracking-context.js";
import type { BoardMetadataById } from "../collectors/board-metadata.js";
import type { WorksheetAuditContext } from "../worksheet/worksheet-reader.js";
import type { DiscordTeamContext } from "../team/discord-guild-members.js";
import { filterSourceUnavailableSkips } from "../reports/report-presentation.js";
import { partitionTasksForAudit } from "../tasks/task-classification.js";
import { allRules } from "./registry.js";
import {
  countEntityViolations,
  evaluateEntityFindings,
} from "./evaluate-entity.js";
import { isEntityRule } from "./rule-scopes.js";
import type {
  AuditResult,
  CardAudit,
  EntityFinding,
  ProjectEvaluation,
  RuleContext,
  RuleResult,
} from "./rule-types.js";
import { ruleLabel } from "../reports/rule-labels.js";

export type EvaluateExtras = {
  scrum?: ScrumAuditContext | null;
  tracking?: TrackingAuditContext | null;
  boardMetrics?: BoardAuditMetrics;
  stateNameByKey?: Record<string, string>;
  auditProfileId?: string;
  boardMetadata?: BoardMetadataById;
  worksheet?: WorksheetAuditContext | null;
  discordTeam?: DiscordTeamContext | null;
};

function buildContext(
  config: AuditConfig,
  allTasks: RawTask[],
  appTaskUsers?: AppTaskUser[],
  extras?: EvaluateExtras,
): RuleContext {
  const profileId = resolveAuditProfileId(extras?.auditProfileId);
  return {
    config,
    allTasks,
    appTaskUsers,
    scrum: extras?.scrum ?? null,
    tracking: extras?.tracking ?? null,
    boardMetrics: extras?.boardMetrics,
    stateNameByKey: extras?.stateNameByKey,
    auditProfileId: profileId,
    boardMetadata: extras?.boardMetadata,
    worksheet: extras?.worksheet ?? null,
    discordTeam: extras?.discordTeam ?? null,
  };
}

function rulesForProfile(profileId: string) {
  const profile = getAuditProfile(
    profileId as ReturnType<typeof resolveAuditProfileId>,
  );
  return allRules.filter((rule) => isRuleInProfile(rule.id, profile));
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
  skipCount: number;
} {
  let failCount = 0;
  let warnCount = 0;
  let skipCount = 0;
  for (const r of results) {
    if (r.status === "FAIL") failCount++;
    if (r.status === "WARN") warnCount++;
    if (r.status === "SKIP") skipCount++;
  }
  return { failCount, warnCount, skipCount };
}

function summarizeSkips(
  cards: CardAudit[],
): AuditResult["meta"]["skipRuleSummaries"] {
  const map = new Map<string, { count: number; sampleReason: string }>();
  for (const card of cards) {
    for (const r of card.results) {
      if (r.status !== "SKIP") continue;
      const entry = map.get(r.ruleId) ?? { count: 0, sampleReason: r.reason };
      entry.count++;
      map.set(r.ruleId, entry);
    }
  }
  return [...map.entries()].map(([ruleId, v]) => ({
    ruleId,
    label: ruleLabel(ruleId),
    count: v.count,
    sampleReason: v.sampleReason,
  }));
}

function summarizeEntitySkips(
  findings: EntityFinding[],
): AuditResult["meta"]["skipRuleSummaries"] {
  const map = new Map<string, { sampleReason: string }>();
  for (const f of findings) {
    if (f.status !== "SKIP") continue;
    if (!map.has(f.ruleId)) {
      map.set(f.ruleId, { sampleReason: f.reason });
    }
  }
  return [...map.entries()].map(([ruleId, v]) => ({
    ruleId,
    label: ruleLabel(ruleId),
    count: 1,
    sampleReason: v.sampleReason,
  }));
}

function mergeSkipSummaries(
  cardSkips: AuditResult["meta"]["skipRuleSummaries"],
  entitySkips: AuditResult["meta"]["skipRuleSummaries"],
): AuditResult["meta"]["skipRuleSummaries"] {
  const map = new Map<string, { count: number; sampleReason: string }>();
  for (const s of [...(cardSkips ?? []), ...(entitySkips ?? [])]) {
    const entry = map.get(s.ruleId) ?? { count: 0, sampleReason: s.sampleReason };
    entry.count += s.count;
    map.set(s.ruleId, entry);
  }
  return [...map.entries()].map(([ruleId, v]) => ({
    ruleId,
    label: ruleLabel(ruleId),
    count: v.count,
    sampleReason: v.sampleReason,
  }));
}

function detectSourcesUsed(extras?: EvaluateExtras): string[] {
  const sources: string[] = ["AppTask DB"];
  if (extras?.scrum?.loaded) sources.push("Scrum");
  if (extras?.tracking?.loaded) sources.push("tracking-hours");
  if (extras?.stateNameByKey && Object.keys(extras.stateNameByKey).length > 0) {
    sources.push("status history");
  }
  if (extras?.boardMetadata && Object.keys(extras.boardMetadata).length > 0) {
    sources.push("метаданные доски");
  }
  if (extras?.worksheet?.loaded) sources.push("рабочая таблица");
  return sources;
}

/** Оценка одной карточки по правилам активного профиля. */
export async function evaluateTask(
  rawTask: RawTask,
  config: AuditConfig,
  allTasks: RawTask[] = [],
  appTaskUsers?: AppTaskUser[],
  extras?: EvaluateExtras,
): Promise<RuleResult[]> {
  const ctx = buildContext(
    config,
    allTasks.length > 0 ? allTasks : [rawTask],
    appTaskUsers,
    extras,
  );
  const rules = rulesForProfile(ctx.auditProfileId ?? "contract_turboweave_v1");
  const taskRules = rules.filter((rule) => !isEntityRule(rule.id));
  return Promise.all(taskRules.map((rule) => runRule(rule, rawTask, ctx)));
}

export type ProjectEvaluationMeta = {
  excludedFlowTasks: number;
  excludedFlowExamples: Array<{ id: string; title: string; url: string | null }>;
  excludedFlowCards: Array<{
    id: string;
    title: string;
    url: string | null;
    status: string | null;
    assignee: string | null;
  }>;
  auditProfile: string;
  sourcesUsed: string[];
  skipRuleSummaries: AuditResult["meta"]["skipRuleSummaries"];
  sourceSkipRuleCount: number;
  totalTasksOnBoard: number;
  entityFindings: EntityFinding[];
  taskLevelFailCount: number;
  taskLevelWarnCount: number;
  entityLevelFailCount: number;
  entityLevelWarnCount: number;
};

/** Оценка всех карточек доски с исключением потоковых задач. */
export async function evaluateProject(
  tasks: RawTask[],
  config: AuditConfig,
  appTaskUsers?: AppTaskUser[],
  extras?: EvaluateExtras,
): Promise<ProjectEvaluation & { meta: ProjectEvaluationMeta }> {
  const profileId = resolveAuditProfileId(extras?.auditProfileId);
  const profile = getAuditProfile(profileId);
  const { auditable, excludedFlow } = partitionTasksForAudit(tasks, profile);
  const ctx = buildContext(config, tasks, appTaskUsers, {
    ...extras,
    auditProfileId: profileId,
  });
  const rules = rulesForProfile(profileId);
  const taskRules = rules.filter((rule) => !isEntityRule(rule.id));
  const entityFindings = evaluateEntityFindings(ctx, auditable, tasks);

  const cards: CardAudit[] = await Promise.all(
    auditable.map(async (task) => ({
      task,
      results: await Promise.all(
        taskRules.map((rule) => runRule(rule, task, ctx)),
      ),
    })),
  );

  let taskLevelFailCount = 0;
  let taskLevelWarnCount = 0;
  for (const card of cards) {
    const counts = countStatuses(card.results);
    taskLevelFailCount += counts.failCount;
    taskLevelWarnCount += counts.warnCount;
  }

  const entityCounts = countEntityViolations(entityFindings);
  const failCount = taskLevelFailCount + entityCounts.failCount;
  const warnCount = taskLevelWarnCount + entityCounts.warnCount;

  const excludedFlowExamples = excludedFlow.slice(0, 10).map((t) => ({
    id: t.id ?? "?",
    title: t.title ?? "(без названия)",
    url: t.url,
  }));

  const excludedFlowCards = excludedFlow.map((t) => ({
    id: t.id ?? "?",
    title: t.title ?? "(без названия)",
    url: t.url,
    status: t.status,
    assignee: t.assignees[0] ?? null,
  }));

  const cardSkips = summarizeSkips(cards);
  const entitySkips = summarizeEntitySkips(entityFindings);
  const skipRuleSummaries = mergeSkipSummaries(cardSkips, entitySkips);
  const sourceSkipRuleCount = filterSourceUnavailableSkips(
    skipRuleSummaries ?? [],
  ).length;

  return {
    cards,
    failCount,
    warnCount,
    entityFindings,
    meta: {
      excludedFlowTasks: excludedFlow.length,
      excludedFlowExamples,
      excludedFlowCards,
      auditProfile: profileId,
      sourcesUsed: detectSourcesUsed(extras),
      skipRuleSummaries,
      sourceSkipRuleCount,
      totalTasksOnBoard: tasks.length,
      entityFindings,
      taskLevelFailCount,
      taskLevelWarnCount,
      entityLevelFailCount: entityCounts.failCount,
      entityLevelWarnCount: entityCounts.warnCount,
    },
  };
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
  extras?: EvaluateExtras,
): Promise<AuditResult> {
  const project = await evaluateProject(tasks, config, appTaskUsers, extras);
  return {
    meta: {
      ...meta,
      cardsChecked: project.cards.length,
      failCount: project.failCount,
      warnCount: project.warnCount,
      auditProfile: project.meta.auditProfile,
      excludedFlowTasks: project.meta.excludedFlowTasks,
      excludedFlowExamples: project.meta.excludedFlowExamples,
      excludedFlowCards: project.meta.excludedFlowCards,
      totalTasksOnBoard: project.meta.totalTasksOnBoard,
      sourceSkipRuleCount: project.meta.sourceSkipRuleCount,
      skipRuleSummaries: project.meta.skipRuleSummaries,
      sourcesUsed: project.meta.sourcesUsed,
      entityFindings: project.meta.entityFindings,
      taskLevelFailCount: project.meta.taskLevelFailCount,
      taskLevelWarnCount: project.meta.taskLevelWarnCount,
      entityLevelFailCount: project.meta.entityLevelFailCount,
      entityLevelWarnCount: project.meta.entityLevelWarnCount,
    },
    entityFindings: project.entityFindings,
    topIssues: [],
    cards: project.cards,
  };
}
