import { getAuditProfile } from "../config/audit-profiles.js";
import type { ContractCheckRegistryEntry } from "../config/contract-check-registry.js";
import { isEntityRule } from "../rules/rule-scopes.js";
import type {
  AuditResult,
  CardAudit,
  EntityFinding,
  RuleResult,
} from "../rules/rule-types.js";
import { buildTaskClassificationRows } from "../tasks/task-type-classification.js";
import {
  buildRegistryTableRows,
  getTaskRuleStats,
  summarizeRegistryOutcomes,
  type RegistryOutcome,
  type RegistryTableRow,
} from "./check-registry-stats.js";
import {
  expectedForRule,
  parseScrumTitleMismatch,
  type TaskViolationGroup,
} from "./evidence-markdown.js";
import { ruleCondition } from "./rule-conditions.js";
import { ruleLabel } from "./rule-labels.js";
import {
  formatAuditedAt,
  humanizeProfileLabel,
  humanizeSourcesUsed,
  simplifyReasonText,
} from "./report-presentation.js";

export type TaskViolationRow = {
  card: CardAudit;
  rule: RuleResult;
  actual: string;
  expected: string;
  source: string;
};

export type CheckBlockView = {
  entry: ContractCheckRegistryEntry;
  registry: RegistryTableRow;
  ruleId: string;
  label: string;
  condition: string;
  passCount: number;
  failCount: number;
  warnCount: number;
  violations: TaskViolationRow[];
  passes: CardAudit[];
  entityFindings: EntityFinding[];
};

export type SectionTocView = {
  section: string;
  sectionId: string;
  passCount: number;
  violationCount: number;
  checkNums: number[];
};

export type ClassificationRowView = {
  id: string;
  title: string;
  url: string | null;
  bucketLabel: string;
  reason: string;
  appliedRules: string;
};

export type ReportViewModel = {
  title: string;
  summary: {
    projectName: string;
    boardUrl: string;
    auditedAt: string;
    totalOnBoard: number;
    cardsChecked: number;
    excludedFlow: number;
    ignoredManual: number;
    failCount: number;
    warnCount: number;
    taskFail: number;
    taskWarn: number;
    entityFail: number;
    entityWarn: number;
    registryChecked: number;
    registrySkip: number;
    registryNotApplicable: number;
    status: string;
    profile: string;
    sources: string;
  };
  classificationCounts: {
    flow: number;
    ui: number;
    regular: number;
    unknown: number;
  };
  sections: SectionTocView[];
  checks: CheckBlockView[];
  classificationRows: ClassificationRowView[];
  excludedCards: Array<{
    id: string;
    title: string;
    url: string | null;
    status: string | null;
    assignee: string | null;
  }>;
  problematicCards: CardAudit[];
};

function overallStatus(failCount: number, warnCount: number): string {
  if (failCount > 0) return "Требует исправлений (есть FAIL)";
  if (warnCount > 0) return "Есть предупреждения (WARN)";
  return "Нарушений не выявлено";
}

function profileFor(result: AuditResult) {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  return getAuditProfile(profileId);
}

function violationsForRule(result: AuditResult, ruleId: string): TaskViolationRow[] {
  const rows: TaskViolationRow[] = [];
  for (const card of result.cards) {
    for (const r of card.results) {
      if (r.ruleId !== ruleId) continue;
      if (r.status !== "FAIL" && r.status !== "WARN") continue;
      const parsed = parseScrumTitleMismatch(r.reason);
      rows.push({
        card,
        rule: r,
        actual: parsed?.actual ?? simplifyReasonText(r.reason),
        expected: parsed?.expected ?? expectedForRule(ruleId, r.reason),
        source: "AppTask card",
      });
    }
  }
  return rows;
}

function passesForRule(result: AuditResult, ruleId: string): CardAudit[] {
  return result.cards.filter((card) => {
    const r = card.results.find((x) => x.ruleId === ruleId);
    return r?.status === "PASS";
  });
}

function entityFindingsForRule(
  result: AuditResult,
  ruleId: string,
): EntityFinding[] {
  const findings = result.entityFindings ?? result.meta.entityFindings ?? [];
  return findings.filter(
    (f) =>
      f.ruleId === ruleId &&
      (f.status === "FAIL" || f.status === "WARN" || f.status === "PASS"),
  );
}

function buildCheckBlock(
  registry: RegistryTableRow,
  result: AuditResult,
): CheckBlockView {
  const ruleId = registry.entry.ruleIds[0]!;
  const stats = isEntityRule(ruleId)
    ? null
    : getTaskRuleStats(result, ruleId);
  const entity = entityFindingsForRule(result, ruleId);
  const entityFail = entity.filter((f) => f.status === "FAIL").length;
  const entityWarn = entity.filter((f) => f.status === "WARN").length;

  return {
    entry: registry.entry,
    registry,
    ruleId,
    label: ruleLabel(ruleId),
    condition: ruleCondition(ruleId),
    passCount: stats?.pass ?? (entity.some((f) => f.status === "PASS") ? 1 : 0),
    failCount: stats?.fail ?? entityFail,
    warnCount: stats?.warn ?? entityWarn,
    violations: violationsForRule(result, ruleId),
    passes: passesForRule(result, ruleId),
    entityFindings: entity.filter((f) => f.status === "FAIL" || f.status === "WARN"),
  };
}

function buildSections(
  result: AuditResult,
  checks: CheckBlockView[],
): SectionTocView[] {
  const profile = profileFor(result);
  return profile.reportGroups.map((group) => {
    const ruleSet = new Set(group.ruleIds);
    const sectionChecks = checks.filter((c) => ruleSet.has(c.ruleId));
    let passCount = 0;
    let violationCount = 0;
    for (const c of sectionChecks) {
      passCount += c.passCount;
      violationCount += c.failCount + c.warnCount + c.entityFindings.length;
    }
    return {
      section: group.section,
      sectionId: slugSection(group.section),
      passCount,
      violationCount,
      checkNums: sectionChecks.map((c) => c.entry.num),
    };
  });
}

function slugSection(section: string): string {
  return section
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function buildClassification(result: AuditResult): {
  rows: ClassificationRowView[];
  counts: ReportViewModel["classificationCounts"];
} {
  const profile = profileFor(result);
  const allTasks = [
    ...result.cards.map((c) => c.task),
    ...(result.meta.excludedFlowCards ?? []).map((ex) => ({
      id: ex.id,
      title: ex.title,
      url: ex.url,
      status: ex.status,
      assignees: ex.assignee ? [ex.assignee] : [],
      descriptionText: null,
      createdAt: null,
      startDate: null,
      dueDate: null,
      priority: null,
      tags: [],
      creator: null,
      assigneeRefs: [],
      category: null,
      stage: null,
      plannedTime: null,
      actualTime: null,
      links: [],
      attachments: [],
      comments: [],
      boardId: null,
    })),
  ];
  const seen = new Set<string>();
  const uniqueTasks = allTasks.filter((t) => {
    if (!t.id || seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  const bucketLabel: Record<string, string> = {
    flow: "потоковая / сервисная",
    ui: "UI/front",
    regular: "обычная",
    unknown: "неизвестно",
  };
  const rows = buildTaskClassificationRows(uniqueTasks, profile).map((row) => ({
    id: row.id,
    title: row.title,
    url: uniqueTasks.find((t) => t.id === row.id)?.url ?? null,
    bucketLabel: bucketLabel[row.bucket] ?? row.bucket,
    reason: row.reason,
    appliedRules: row.appliedRules,
  }));
  const counts = { flow: 0, ui: 0, regular: 0, unknown: 0 };
  for (const row of buildTaskClassificationRows(uniqueTasks, profile)) {
    if (row.bucket in counts) {
      counts[row.bucket as keyof typeof counts]++;
    }
  }
  return { rows, counts };
}

function problematicCards(result: AuditResult): CardAudit[] {
  return result.cards.filter((c) =>
    c.results.some(
      (r) =>
        (r.status === "FAIL" || r.status === "WARN") && !isEntityRule(r.ruleId),
    ),
  );
}

export function buildReportViewModel(
  result: AuditResult,
  extras: { ignoredCount?: number } = {},
): ReportViewModel {
  const { meta } = result;
  const registryRows = buildRegistryTableRows(result);
  const registrySummary = summarizeRegistryOutcomes(registryRows);
  const checks = registryRows
    .filter((r) => r.outcome !== "NOT_APPLICABLE")
    .map((r) => buildCheckBlock(r, result));
  const classification = buildClassification(result);
  const excluded = meta.excludedFlowCards ?? meta.excludedFlowExamples ?? [];
  const excludedFlow = meta.excludedFlowTasks ?? 0;
  const totalOnBoard = meta.totalTasksOnBoard ?? meta.cardsChecked + excludedFlow;
  const taskFail = meta.taskLevelFailCount ?? 0;
  const taskWarn = meta.taskLevelWarnCount ?? 0;
  const entityFail = meta.entityLevelFailCount ?? 0;
  const entityWarn = meta.entityLevelWarnCount ?? 0;

  return {
    title: `AppTask Audit Report — ${meta.projectName}`,
    summary: {
      projectName: meta.projectName,
      boardUrl: meta.boardUrl,
      auditedAt: formatAuditedAt(meta.auditedAt),
      totalOnBoard,
      cardsChecked: meta.cardsChecked,
      excludedFlow,
      ignoredManual: extras.ignoredCount ?? 0,
      failCount: meta.failCount,
      warnCount: meta.warnCount,
      taskFail,
      taskWarn,
      entityFail,
      entityWarn,
      registryChecked: registrySummary.checked,
      registrySkip: registrySummary.skip,
      registryNotApplicable: registrySummary.notApplicable,
      status: overallStatus(meta.failCount, meta.warnCount),
      profile: humanizeProfileLabel(meta.auditProfile),
      sources: humanizeSourcesUsed(meta.sourcesUsed),
    },
    classificationCounts: classification.counts,
    sections: buildSections(result, checks),
    checks,
    classificationRows: classification.rows,
    excludedCards: excluded.map((ex) => ({
      id: ex.id,
      title: ex.title,
      url: ex.url,
      status: "status" in ex ? (ex as { status: string | null }).status : null,
      assignee:
        "assignee" in ex ? (ex as { assignee: string | null }).assignee : null,
    })),
    problematicCards: problematicCards(result),
  };
}

export function outcomeClass(outcome: RegistryOutcome): string {
  switch (outcome) {
    case "OK":
      return "ok";
    case "FAIL":
      return "fail";
    case "WARN":
      return "warn";
    case "SKIP":
      return "skip";
    default:
      return "muted";
  }
}

export type { TaskViolationGroup };
