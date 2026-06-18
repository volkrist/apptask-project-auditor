import type { AuditResult, CardAudit, EntityFinding } from "../rules/rule-types.js";
import { getAuditProfile } from "../config/audit-profiles.js";
import { isEntityRule } from "../rules/rule-scopes.js";
import { ruleLabel } from "./rule-labels.js";
import { ruleCondition } from "./rule-conditions.js";
import {
  filterSourceUnavailableSkips,
  formatAuditedAt,
  humanizeProfileLabel,
  humanizeSourcesUsed,
  simplifyReasonText,
  skipExplanationForReport,
} from "./report-presentation.js";
import { formatCheckRegistryMarkdown } from "./build-check-registry.js";

function overallStatus(failCount: number, warnCount: number): string {
  if (failCount > 0) return "Требует исправлений (есть FAIL)";
  if (warnCount > 0) return "Есть предупреждения (WARN)";
  return "Нарушений не выявлено";
}

function humanLabel(ruleId: string): string {
  return ruleLabel(ruleId);
}

type TaskViolationGroup = {
  ruleId: string;
  status: "FAIL" | "WARN";
  cards: CardAudit[];
  sampleReason: string;
};

function taskViolationsBySection(
  result: AuditResult,
): Map<string, TaskViolationGroup[]> {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  const profile = getAuditProfile(profileId);
  const bySection = new Map<string, TaskViolationGroup[]>();

  for (const group of profile.reportGroups) {
    const ruleSet = new Set(group.ruleIds.filter((id) => !isEntityRule(id)));
    const byRule = new Map<string, TaskViolationGroup>();

    for (const card of result.cards) {
      for (const r of card.results) {
        if (r.status !== "FAIL" && r.status !== "WARN") continue;
        if (!ruleSet.has(r.ruleId)) continue;
        let entry = byRule.get(r.ruleId);
        if (!entry) {
          entry = {
            ruleId: r.ruleId,
            status: r.status,
            cards: [],
            sampleReason: r.reason,
          };
          byRule.set(r.ruleId, entry);
        }
        if (r.status === "FAIL") entry.status = "FAIL";
        if (!entry.cards.includes(card)) entry.cards.push(card);
      }
    }

    const groups = [...byRule.values()].sort((a, b) => {
      if (a.status !== b.status) return a.status === "FAIL" ? -1 : 1;
      return b.cards.length - a.cards.length;
    });
    if (groups.length > 0) bySection.set(group.section, groups);
  }

  return bySection;
}

function entityFindingsForSection(
  result: AuditResult,
  sectionRuleIds: readonly string[],
): EntityFinding[] {
  const ruleSet = new Set(sectionRuleIds.filter((id) => isEntityRule(id)));
  const findings = result.entityFindings ?? result.meta.entityFindings ?? [];
  return findings.filter((f) => {
    if (!ruleSet.has(f.ruleId)) return false;
    if (f.status === "FAIL" || f.status === "WARN") return true;
    if (f.ruleId === "board_name_template" && f.status === "PASS") return true;
    if (f.ruleId === "task_type_classification" && f.status === "PASS") return true;
    return false;
  });
}

function formatCardBullet(card: CardAudit): string {
  const t = card.task;
  const id = t.id ? `№${t.id}` : "без номера";
  const assignee = t.assignees[0] ?? "—";
  const title = t.title ?? "(без названия)";
  const status = t.status ?? "—";
  if (t.url) {
    return `* [${id}](${t.url}) — ${title} | ${status} | ${assignee}`;
  }
  return `* ${id} — ${title} | ${status} | ${assignee}`;
}

function formatTaskCheckBlock(group: TaskViolationGroup): string[] {
  const count = group.cards.length;
  const statusLabel = group.status;
  const reason = simplifyReasonText(group.sampleReason);
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel(group.ruleId)}`,
    "",
    `Условие: ${ruleCondition(group.ruleId)}.`,
    `Результат: ${statusLabel} — ${reason || `найдено ${count} карточек`}.`,
  ];
  if (count > 0) {
    lines.push("", "Карточки:", "");
    for (const card of group.cards) {
      lines.push(formatCardBullet(card));
    }
  }
  return lines;
}

function formatEntityCheckBlock(finding: EntityFinding): string[] {
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel(finding.ruleId)}`,
    "",
    `Условие: ${ruleCondition(finding.ruleId)}.`,
    `Результат: ${finding.status} — ${simplifyReasonText(finding.reason)}.`,
    `Объект: ${finding.objectLabel}.`,
  ];
  if (finding.actualValue) {
    lines.push(`Фактическое значение: ${finding.actualValue}.`);
  }
  if (finding.details && finding.details.length > 0) {
    lines.push("", "Детали:");
    for (const d of finding.details) {
      lines.push(`* ${d}`);
    }
  }
  return lines;
}

function problematicCards(result: AuditResult): CardAudit[] {
  return result.cards.filter((c) =>
    c.results.some(
      (r) =>
        (r.status === "FAIL" || r.status === "WARN") && !isEntityRule(r.ruleId),
    ),
  );
}

function cardViolations(card: CardAudit): typeof card.results {
  const seen = new Set<string>();
  const out: typeof card.results = [];
  for (const r of card.results) {
    if (r.status !== "FAIL" && r.status !== "WARN") continue;
    if (isEntityRule(r.ruleId)) continue;
    if (seen.has(r.ruleId)) continue;
    seen.add(r.ruleId);
    out.push(r);
  }
  return out;
}

export function buildContractAuditMarkdown(
  result: AuditResult,
  extras: { ignoredCount?: number } = {},
): string {
  const { meta } = result;
  const excludedFlow = meta.excludedFlowTasks ?? 0;
  const totalOnBoard = meta.totalTasksOnBoard ?? meta.cardsChecked + excludedFlow;
  const ignoredManual = extras.ignoredCount ?? 0;
  const sourceSkips = filterSourceUnavailableSkips(meta.skipRuleSummaries ?? []);
  const taskFail = meta.taskLevelFailCount ?? 0;
  const taskWarn = meta.taskLevelWarnCount ?? 0;
  const entityFail = meta.entityLevelFailCount ?? 0;
  const entityWarn = meta.entityLevelWarnCount ?? 0;

  const lines: string[] = [
    "# Отчёт аудита AppTask",
    "",
    "## Общая сводка",
    "",
    `- Проект: ${meta.projectName}`,
    `- Доска: ${meta.boardUrl}`,
    `- Дата: ${formatAuditedAt(meta.auditedAt)}`,
    `- Всего карточек на доске: ${totalOnBoard}`,
    `- Проверено карточек: ${meta.cardsChecked}`,
    `- Исключено потоковых / сервисных карточек: ${excludedFlow}`,
  ];

  if (ignoredManual > 0) {
    lines.push(`- Исключено вручную: ${ignoredManual}`);
  }

  lines.push(
    `- FAIL: ${meta.failCount} (карточки: ${taskFail}, объекты: ${entityFail})`,
    `- WARN: ${meta.warnCount} (карточки: ${taskWarn}, объекты: ${entityWarn})`,
    `- SKIP из-за отсутствия источников: ${sourceSkips.length}`,
    `- Статус: ${overallStatus(meta.failCount, meta.warnCount)}`,
    "",
    "## Область проверки",
    "",
    `- Доска: ${meta.boardUrl}`,
    `- Источники данных: ${humanizeSourcesUsed(meta.sourcesUsed)}`,
    `- Профиль проверки: ${humanizeProfileLabel(meta.auditProfile)}`,
    `- Исключения: потоковые / сервисные карточки (${excludedFlow})`,
  );

  if (excludedFlow > 0) {
    lines.push(
      "- Потоковые карточки исключены из проверок карточек, но их фактическое время учитывается в проверке дневного списания времени.",
    );
  }

  if (meta.boardSummaries && meta.boardSummaries.length > 1) {
    lines.push("", "### Доски в аудите");
    for (const b of meta.boardSummaries) {
      lines.push(
        `- Доска ${b.boardId}: проверено ${b.tasksChecked} из ${b.tasksAvailable} | FAIL ${b.failCount} | WARN ${b.warnCount}`,
      );
    }
  }

  lines.push("", "## Результаты проверок");

  const profile = getAuditProfile(
    (meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
      "contract_turboweave_v1",
  );
  const taskSections = taskViolationsBySection(result);
  let hasAnyResults = false;

  for (const group of profile.reportGroups) {
    const taskGroups = taskSections.get(group.section) ?? [];
    const entityGroups = entityFindingsForSection(result, group.ruleIds);
    if (taskGroups.length === 0 && entityGroups.length === 0) continue;

    hasAnyResults = true;
    lines.push("", `### ${group.section}`);
    for (const entity of entityGroups) {
      lines.push(...formatEntityCheckBlock(entity));
    }
    for (const taskGroup of taskGroups) {
      lines.push(...formatTaskCheckBlock(taskGroup));
    }
  }

  if (!hasAnyResults) {
    lines.push("", "Нарушений по проверкам не найдено.");
  }

  lines.push("");
  lines.push(...formatCheckRegistryMarkdown(result));

  lines.push("", "## Исключённые карточки", "");
  const excluded = meta.excludedFlowCards ?? meta.excludedFlowExamples ?? [];
  if (excluded.length === 0) {
    lines.push("Нет исключённых карточек.");
  } else {
    lines.push(`Всего исключено: ${excluded.length}`, "");
    for (const ex of excluded) {
      const id = ex.id ? `№${ex.id}` : "без номера";
      const status = "status" in ex ? (ex as { status: string | null }).status ?? "—" : "—";
      const assignee =
        "assignee" in ex ? (ex as { assignee: string | null }).assignee ?? "—" : "—";
      if (ex.url) {
        lines.push(`* [${id}](${ex.url}) — ${ex.title} | ${status} | ${assignee}`);
      } else {
        lines.push(`* ${id} — ${ex.title} | ${status} | ${assignee}`);
      }
    }
  }

  if (sourceSkips.length > 0) {
    lines.push("", "## Не проверено автоматически", "");
    for (const s of sourceSkips) {
      const reason = skipExplanationForReport(s.ruleId, s.sampleReason);
      lines.push(
        `#### Проверка: ${humanLabel(s.ruleId)}`,
        "",
        `Условие: ${ruleCondition(s.ruleId)}.`,
        `Результат: SKIP.`,
        `Причина: ${reason}.`,
        "",
      );
    }
  }

  lines.push("## Детализация по карточкам");
  const problematic = problematicCards(result);
  if (problematic.length === 0) {
    lines.push("", "Проблемных карточек нет.");
  } else {
    for (const card of problematic) {
      const t = card.task;
      const id = t.id ? `№${t.id}` : "без номера";
      lines.push(
        "",
        `### ${id} — ${t.title ?? "(без названия)"}`,
        `- Ссылка: ${t.url ?? "—"}`,
        `- Статус: ${t.status ?? "—"}`,
        `- Исполнитель: ${t.assignees[0] ?? "—"}`,
        "",
        "Нарушения:",
      );
      for (const r of cardViolations(card)) {
        lines.push(
          `- ${humanLabel(r.ruleId)} (${r.status}): ${simplifyReasonText(r.reason)}`,
        );
      }
    }
  }

  const body = lines.join("\n");
  const banned = [
    "Что сделать",
    "Рекомендация",
    "Совет",
    "Главные проблемы",
    "Что исправить в первую очередь",
    "contract_turboweave_v1",
    "tracking-hours",
    "board metadata collector",
    "WORKSHEET_SOURCE",
    "Daily breakdown tracking",
  ];
  for (const phrase of banned) {
    if (body.includes(phrase)) {
      throw new Error(`Report contains banned phrase: ${phrase}`);
    }
  }

  return `${body}\n`;
}
