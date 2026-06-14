import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";
import type { AppTaskUser } from "../users/app-task-users.js";
import type {
  BoardAuditMetrics,
  ScrumAuditContext,
} from "../scrum/scrum-estimate-config.js";

export type RuleStatus = "PASS" | "FAIL" | "WARN";

export type RuleResult = {
  ruleId: string;
  status: RuleStatus;
  reason: string;
};

export type RuleContext = {
  config: AuditConfig;
  allTasks: RawTask[];
  appTaskUsers?: AppTaskUser[];
  scrum?: ScrumAuditContext | null;
  boardMetrics?: BoardAuditMetrics;
  /** boardId:stateId → status name (DB collector). */
  stateNameByKey?: Record<string, string>;
};

export type Rule = {
  id: string;
  severity: "hard" | "soft";
  evaluate: (
    task: RawTask,
    ctx: RuleContext,
  ) => RuleResult | Promise<RuleResult>;
};

export type CardAudit = {
  task: RawTask;
  results: RuleResult[];
};

export type ProjectEvaluation = {
  cards: CardAudit[];
  failCount: number;
  warnCount: number;
};

export type AuditResult = {
  meta: {
    projectName: string;
    boardUrl: string;
    auditedAt: string;
    cardsChecked: number;
    failCount: number;
    warnCount: number;
    /** playwright | api | db */
    collectorSource?: string;
    scrumMatchDisclaimer?: string;
    boardsChecked?: number;
    /** single — одна доска из boardUrl; multi — все APPTASK_DB_BOARD_IDS */
    auditScope?: "single" | "multi";
    /** maxCards считается суммарно по всем доскам (round-robin) */
    maxCardsScope?: "total";
    boardSummaries?: Array<{
      boardId: string;
      boardUrl: string;
      tasksChecked: number;
      tasksAvailable: number;
      failCount: number;
      warnCount: number;
    }>;
    issueCounts?: {
      deadlineIssues: number;
      staleInProgressIssues: number;
      staleReviewIssues: number;
      testingQueueIssues: number;
      criticalNoMovementIssues: number;
      commentIssues: number;
      scrumEstimateMissing: number;
      scrumNameMismatch: number;
      pvMissing: number;
      decompositionMissing: number;
    };
    boardMetrics?: BoardAuditMetrics;
    /** boardId:stateId → status name when collected from DB. */
    stateNameByKey?: Record<string, string>;
    scrumEstimateLoaded?: boolean;
    scrumLoadError?: string;
    scrumEstimateRows?: number;
    scrumSources?: import("../scrum/scrum-estimate-config.js").ScrumSourceLoadStatus[];
    scrumLoadStats?: import("../scrum/scrum-estimate-config.js").EstimateLoadStats;
    scrumMatchStats?: import("../scrum/estimate-matcher.js").ScrumMatchStats;
  };
  topIssues: Array<{ ruleId: string; label: string; count: number }>;
  cards: CardAudit[];
};
