import type { AuditConfig } from "../config/audit-config.js";
import type { AuditScope } from "../config/audit-scope.js";
import { buildBoardSummaries } from "../config/audit-scope.js";
import type { RawTask } from "../adapters/apptask/types.js";
import type { AppTaskUser } from "../users/app-task-users.js";
import { loadScrumAuditContext } from "../scrum/load-scrum-context.js";
import { computeScrumMatchStats } from "../scrum/estimate-matcher.js";
import { isScrumAuditBoard } from "../scrum/scrum-estimate-config.js";
import { buildBoardAuditMetrics } from "./board-metrics.js";
import { loadTrackingAuditContext } from "../tracking/load-tracking-context.js";
import { loadBoardMetadataById } from "../collectors/board-metadata.js";
import { loadDbConfig } from "../collectors/db-config.js";
import { closeDb } from "../collectors/db-client.js";
import { loadWorksheetAuditContext } from "../worksheet/worksheet-reader.js";
import { loadDiscordTeamContext } from "../team/discord-guild-members.js";
import { TURBOWEAVE_GUILD_ID } from "../config/audit-modes.js";
import { computeIssueCounts } from "./structured-findings.js";
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

export type BuildAuditOptions = {
  collectorSource?: string;
  boardsChecked?: number;
  auditScope?: AuditScope;
  maxCardsScope?: "total";
  availableByBoard?: Record<string, number>;
  appTaskBaseUrl?: string;
  stateNameByKey?: Record<string, string>;
};

/** Сборка AuditResult из сырых карточек и конфига правил. */
export async function buildAuditResult(
  tasks: RawTask[],
  config: AuditConfig,
  meta: AuditMetaInput,
  appTaskUsers?: AppTaskUser[],
  options: BuildAuditOptions = {},
): Promise<AuditResult> {
  const scrum = await loadScrumAuditContext();
  const boardIds = [
    ...new Set(
      tasks
        .map((t) => Number(t.boardId))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];
  const tracking = await loadTrackingAuditContext(boardIds);
  const worksheet = await loadWorksheetAuditContext();
  const guildId =
    process.env.AUDIT_DISCORD_GUILD_ID?.trim() ||
    process.env.DISCORD_GUILD_ID?.trim() ||
    TURBOWEAVE_GUILD_ID;
  const discordTeam = await loadDiscordTeamContext(guildId);
  const discordTeamNote = discordTeam.loaded
    ? `guild ${discordTeam.guildId}, участников ${discordTeam.memberDisplayNames.length}`
    : discordTeam.guildId
      ? `недоступна (${discordTeam.loadError ?? "ошибка загрузки"})`
      : "guild id не задан";
  let boardMetadata: Awaited<ReturnType<typeof loadBoardMetadataById>> = {};
  if (boardIds.length > 0) {
    try {
      const dbConfig = loadDbConfig({ boardIds });
      boardMetadata = await loadBoardMetadataById(dbConfig, boardIds);
      await closeDb();
    } catch {
      await closeDb().catch(() => undefined);
    }
  }
  const boardMetrics = buildBoardAuditMetrics(tasks);
  const project = await evaluateProject(tasks, config, appTaskUsers, {
    scrum,
    tracking,
    boardMetrics,
    stateNameByKey: options.stateNameByKey,
    boardMetadata,
    worksheet,
    discordTeam,
  });

  const boardSummaries =
    options.availableByBoard && options.appTaskBaseUrl
      ? buildBoardSummaries(
          project.cards,
          options.availableByBoard,
          options.appTaskBaseUrl,
        )
      : undefined;

  const displayBoardUrl =
    options.auditScope === "multi" && boardSummaries && boardSummaries.length > 0
      ? boardSummaries.map((s) => s.boardUrl).join(", ")
      : meta.boardUrl;

  const issueCounts = computeIssueCounts(project.cards, boardMetrics);
  const scrumMatchStats =
    scrum?.loaded && scrum.rows.length > 0
      ? computeScrumMatchStats(
          tasks.filter((t) => isScrumAuditBoard(t.boardId, scrum.config)),
          scrum.rows,
          scrum.config.decompositionHoursThreshold,
        )
      : undefined;

  const base: AuditResult = {
    meta: {
      projectName: meta.projectName,
      boardUrl: displayBoardUrl,
      auditedAt: meta.auditedAt ?? new Date().toISOString(),
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
      collectorSource: options.collectorSource,
      boardsChecked: options.boardsChecked,
      auditScope: options.auditScope,
      maxCardsScope: options.maxCardsScope,
      boardSummaries,
      issueCounts,
      boardMetrics,
      stateNameByKey: options.stateNameByKey,
      scrumMatchDisclaimer: scrum?.loaded
        ? scrum.config.matchDisclaimer
        : undefined,
      scrumEstimateLoaded: scrum?.loaded ?? false,
      scrumLoadError: scrum?.loaded ? undefined : scrum?.loadError,
      scrumEstimateRows: scrum?.rows.length,
      scrumSources: scrum?.sources,
      scrumLoadStats: scrum?.loadStats,
      scrumMatchStats,
      trackingLoaded: tracking.loaded,
      trackingLoadError: tracking.loaded ? undefined : tracking.loadError,
      trackingRowCount: tracking.rowCount,
      trackingByTaskKey: tracking.byTaskKey,
      discordTeamNote,
    },
    topIssues: [],
    cards: project.cards,
    entityFindings: project.entityFindings,
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
