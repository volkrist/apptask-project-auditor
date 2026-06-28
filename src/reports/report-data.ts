import { getAuditProfile } from "../config/audit-profiles.js";
import type { ContractCheckRegistryEntry } from "../config/contract-check-registry.js";
import { isEntityRule } from "../rules/rule-scopes.js";
import type {
  AuditResult,
  CardAudit,
  EntityFinding,
  RuleResult,
} from "../rules/rule-types.js";
import type { EvidenceResult } from "../rules/evidence-types.js";
import {
  buildBoardClassification,
  type BoardClassificationRow,
} from "./board-classification.js";
import {
  buildRegistryTableRows,
  getTaskRuleStats,
  registryHasZeroCandidates,
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
import { ruleVerificationMethod } from "./rule-verification-methods.js";
import { buildTeamSubSources, type TeamSubSourceView } from "./team-check-composite.js";
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
  verificationMethod: string;
  failCount: number;
  warnCount: number;
  violationCount: number;
  zeroCandidates: boolean;
  showViolationsPanel: boolean;
  showNotCheckedPanel: boolean;
  notCheckedCount: number;
  okBrief: string;
  violations: TaskViolationRow[];
  entityFindings: EntityFinding[];
  evidence?: EvidenceResult;
  subSources?: TeamSubSourceView[];
};

export type SectionTocView = {
  section: string;
  sectionId: string;
  ruleIds: readonly string[];
  checksOk: number;
  checksWithViolations: number;
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
    total: number;
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

function buildOkBrief(
  registry: RegistryTableRow,
  zeroCandidates: boolean,
  violationCount: number,
  evidence: EvidenceResult | undefined,
  result: AuditResult,
): string {
  const num = registry.entry.num;
  const ruleId = registry.entry.ruleIds[0]!;

  if (num === 4 && zeroCandidates && violationCount === 0) {
    return "Кандидатов для проверки нет: заблокированных задач не найдено.";
  }
  if (num === 36 && zeroCandidates && violationCount === 0) {
    return "По фиксированным маркерам «готово/сделал/проверь» нарушений не найдено.";
  }
  if (num === 11 && violationCount === 0) {
    const { counts } = buildBoardClassification(result);
    return `Все карточки классифицированы, неизвестных типов: ${counts.unknown}.`;
  }
  if (
    ruleId === "unresolved_question_keywords_in_card" &&
    zeroCandidates &&
    violationCount === 0
  ) {
    return "По фиксированным маркерам незакрытых вопросов не найдено";
  }
  if (evidence?.automationLevel === "PARTIAL" && registry.outcome === "PARTIAL" && violationCount === 0) {
    const note = evidence.debug?.note?.toString();
    return note ?? "проверено частично — автоматизация неполная";
  }
  if (evidence?.automationLevel === "PARTIAL" && registry.outcome === "OK" && violationCount === 0) {
    return evidence.debug?.note?.toString() ?? "проверено частично";
  }
  if (registry.outcome === "SKIP") {
    if (registry.candidates.includes("нет доступа к списку участников")) {
      return "Discord: доступ к списку участников не предоставлен";
    }
    return "Проверка пропущена (SKIP)";
  }
  if (registry.outcome === "PARTIAL") {
    return "Проверено частично — см. «Не проверено»";
  }
  if (zeroCandidates && violationCount === 0) {
    return "Кандидатов для проверки нет";
  }
  if (registry.outcome === "OK") return "OK — нарушений нет";
  if (registry.outcome === "NOT_APPLICABLE") return "Не применяется";
  return registry.outcome;
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
  const discordEntity =
    registry.entry.num === 8
      ? entityFindingsForRule(result, "team_discord_match").filter(
          (f) => f.status === "FAIL" || f.status === "WARN",
        )
      : [];
  const entityViolations = [
    ...entity.filter((f) => f.status === "FAIL" || f.status === "WARN"),
    ...discordEntity,
  ];
  const violations = violationsForRule(result, ruleId);
  const evidence = registry.evidence;
  const zeroCandidates = registryHasZeroCandidates(registry);
  const violationCount =
    evidence != null
      ? evidence.violationCount
      : violations.length + entityViolations.length;
  const failCount = stats?.fail ?? entityViolations.filter((f) => f.status === "FAIL").length;
  const warnCount = stats?.warn ?? entityViolations.filter((f) => f.status === "WARN").length;
  const notCheckedCount = evidence?.notCheckedCount ?? 0;
  const showViolationsPanel =
    evidence != null ? evidence.violationCount > 0 : violationCount > 0;
  const showNotCheckedPanel = notCheckedCount > 0;

  return {
    entry: registry.entry,
    registry,
    ruleId,
    label: registry.entry.title,
    condition: ruleCondition(ruleId),
    verificationMethod: ruleVerificationMethod(ruleId),
    failCount,
    warnCount,
    violationCount,
    zeroCandidates,
    showViolationsPanel,
    showNotCheckedPanel,
    notCheckedCount,
    okBrief: buildOkBrief(registry, zeroCandidates, violationCount, evidence, result),
    violations,
    entityFindings: entityViolations,
    evidence,
    subSources:
      registry.entry.num === 8 ? buildTeamSubSources(result) : undefined,
  };
}

function buildSections(checks: CheckBlockView[], result: AuditResult): SectionTocView[] {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  const profile = getAuditProfile(profileId);

  return profile.reportGroups.map((group) => {
    const ruleSet = new Set(group.ruleIds);
    const sectionChecks = checks.filter((c) => ruleSet.has(c.ruleId));
    let checksOk = 0;
    let checksWithViolations = 0;
    for (const c of sectionChecks) {
      if (c.registry.outcome === "OK") checksOk++;
      if (c.registry.outcome === "FAIL" || c.registry.outcome === "WARN") {
        checksWithViolations++;
      }
    }
    return {
      section: group.section,
      sectionId: slugSection(group.section),
      ruleIds: group.ruleIds,
      checksOk,
      checksWithViolations,
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

function mapClassificationRow(row: BoardClassificationRow): ClassificationRowView {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    bucketLabel: row.bucketLabel,
    reason: row.reason,
    appliedRules: row.appliedRules,
  };
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
  const registrySummary = summarizeRegistryOutcomes(registryRows, result);
  const checks = registryRows
    .filter((r) => r.outcome !== "NOT_APPLICABLE")
    .map((r) => buildCheckBlock(r, result));
  const boardClass = buildBoardClassification(result);
  const excluded = meta.excludedFlowCards ?? meta.excludedFlowExamples ?? [];
  const excludedFlow = meta.excludedFlowTasks ?? excluded.length;
  const totalOnBoard = meta.totalTasksOnBoard ?? meta.cardsChecked + excludedFlow;

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
      taskFail: meta.taskLevelFailCount ?? 0,
      taskWarn: meta.taskLevelWarnCount ?? 0,
      entityFail: meta.entityLevelFailCount ?? 0,
      entityWarn: meta.entityLevelWarnCount ?? 0,
      registryChecked: registrySummary.checked,
      registrySkip: registrySummary.skip,
      registryNotApplicable: registrySummary.notApplicable,
      status: overallStatus(meta.failCount, meta.warnCount),
      profile: humanizeProfileLabel(meta.auditProfile),
      sources: humanizeSourcesUsed(meta.sourcesUsed),
    },
    classificationCounts: boardClass.counts,
    sections: buildSections(checks, result),
    checks,
    classificationRows: boardClass.rows.map(mapClassificationRow),
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
    case "PARTIAL":
      return "partial";
    default:
      return "muted";
  }
}

export type { TaskViolationGroup };
