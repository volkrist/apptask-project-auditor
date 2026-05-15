import type { AuditConfig } from "../config/audit-config.js";
import type { RawTask } from "../adapters/apptask/types.js";

export type RuleStatus = "PASS" | "FAIL" | "WARN";

export type RuleResult = {
  ruleId: string;
  status: RuleStatus;
  reason: string;
};

export type RuleContext = {
  config: AuditConfig;
  allTasks: RawTask[];
};

export type Rule = {
  id: string;
  severity: "hard" | "soft";
  evaluate: (task: RawTask, ctx: RuleContext) => RuleResult;
};

export type CardAudit = {
  task: RawTask;
  results: RuleResult[];
};

export type AuditResult = {
  meta: {
    projectName: string;
    boardUrl: string;
    auditedAt: string;
    cardsChecked: number;
    failCount: number;
    warnCount: number;
  };
  topIssues: Array<{ ruleId: string; label: string; count: number }>;
  cards: CardAudit[];
};
