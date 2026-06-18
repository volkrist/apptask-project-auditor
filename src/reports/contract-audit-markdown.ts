import type { AuditResult, CardAudit } from "../rules/rule-types.js";
import { getAuditProfile } from "../config/audit-profiles.js";
import { ruleLabel } from "./rule-labels.js";

function statusText(failCount: number, warnCount: number): string {
  if (failCount > 0) return "Требует доработки";
  if (warnCount > 0) return "Есть предупреждения";
  return "Проблем не найдено";
}

function humanLabel(ruleId: string): string {
  return ruleLabel(ruleId);
}

function problematicCards(result: AuditResult): CardAudit[] {
  return result.cards.filter((c) =>
    c.results.some((r) => r.status === "FAIL" || r.status === "WARN"),
  );
}

function violationsBySection(result: AuditResult): Map<string, Map<string, CardAudit[]>> {
  const profileId =
    (result.meta.auditProfile as "contract_turboweave_v1" | "legacy_generic") ??
    "contract_turboweave_v1";
  const profile = getAuditProfile(profileId);
  const bySection = new Map<string, Map<string, CardAudit[]>>();

  for (const group of profile.reportGroups) {
    const ruleSet = new Set(group.ruleIds);
    const byRule = new Map<string, CardAudit[]>();
    for (const card of result.cards) {
      for (const r of card.results) {
        if (r.status !== "FAIL" && r.status !== "WARN") continue;
        if (!ruleSet.has(r.ruleId)) continue;
        const list = byRule.get(r.ruleId) ?? [];
        if (!list.includes(card)) list.push(card);
        byRule.set(r.ruleId, list);
      }
    }
    if (byRule.size > 0) {
      bySection.set(group.section, byRule);
    }
  }

  return bySection;
}

function formatCardLine(card: CardAudit): string {
  const t = card.task;
  const id = t.id ? `№${t.id}` : "без номера";
  const assignee = t.assignees[0] ?? "—";
  return `- [${id}](${t.url ?? "—"}) — ${t.title ?? "(без названия)"} | ${t.status ?? "—"} | ${assignee}`;
}

export function buildContractAuditMarkdown(
  result: AuditResult,
  extras: { ignoredCount?: number } = {},
): string {
  const { meta } = result;
  const excludedFlow = meta.excludedFlowTasks ?? 0;
  const ignoredManual = extras.ignoredCount ?? 0;
  const skipRules = meta.skipRuleSummaries ?? [];
  const profileLabel = meta.auditProfile ?? "contract_turboweave_v1";
  const sources = meta.sourcesUsed?.join(", ") ?? "AppTask DB";

  const lines: string[] = [
    "# Отчёт аудита AppTask",
    "",
    "## Общая сводка",
    `- Проект: ${meta.projectName}`,
    `- Доска / доски: ${meta.boardUrl}`,
    `- Дата: ${meta.auditedAt}`,
    `- Проверено карточек: ${meta.cardsChecked}`,
    `- Исключено потоковых/сервисных карточек: ${excludedFlow}`,
  ];

  if (ignoredManual > 0) {
    lines.push(`- Исключено вручную (ignore list): ${ignoredManual}`);
  }

  if (skipRules.length > 0) {
    lines.push(
      `- Не проверено из-за отсутствия источников: ${skipRules.length} правил`,
    );
  }

  lines.push(
    `- FAIL: ${meta.failCount}`,
    `- WARN: ${meta.warnCount}`,
    `- Общий статус: ${statusText(meta.failCount, meta.warnCount)}`,
    "",
    "## Область проверки",
    `- Профиль правил: ${profileLabel}`,
    `- Источники: ${sources}`,
  );

  if (meta.boardsChecked != null && meta.boardsChecked > 0) {
    lines.push(`- Досок в аудите: ${meta.boardsChecked}`);
  }

  if (meta.boardSummaries && meta.boardSummaries.length > 0) {
    lines.push("", "### Доски");
    for (const b of meta.boardSummaries) {
      lines.push(
        `- **${b.boardId}**: проверено ${b.tasksChecked} из ${b.tasksAvailable} | FAIL ${b.failCount} | WARN ${b.warnCount}`,
      );
    }
  }

  lines.push("", "## Нарушения по группам");

  const sections = violationsBySection(result);
  if (sections.size === 0) {
    lines.push("", "Нарушений по контрактным правилам не найдено.");
  } else {
    for (const [section, byRule] of sections) {
      lines.push("", `### ${section}`);
      for (const [ruleId, cards] of byRule) {
        lines.push("", `**${humanLabel(ruleId)}** (${cards.length})`);
        const sample = cards.slice(0, 15);
        for (const card of sample) {
          const reason =
            card.results.find(
              (r) =>
                r.ruleId === ruleId &&
                (r.status === "FAIL" || r.status === "WARN"),
            )?.reason ?? "";
          lines.push(`${formatCardLine(card)} — ${reason}`);
        }
        if (cards.length > 15) {
          lines.push(`- … и ещё ${cards.length - 15} задач`);
        }
      }
    }
  }

  lines.push("", "## Исключённые карточки");
  lines.push(`- Потоковые/сервисные: ${excludedFlow}`);
  const examples = meta.excludedFlowExamples ?? [];
  if (examples.length > 0) {
    lines.push("", "Примеры:");
    for (const ex of examples.slice(0, 10)) {
      lines.push(`- [№${ex.id}](${ex.url ?? "—"}) — ${ex.title}`);
    }
  }

  if (skipRules.length > 0) {
    lines.push("", "## Не проверено автоматически");
    for (const s of skipRules) {
      lines.push(
        `- **${s.label}** (${s.count}×): ${s.sampleReason}`,
      );
    }
  }

  lines.push("", "## Детализация по карточкам");
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
      const seen = new Set<string>();
      for (const r of card.results) {
        if (r.status !== "FAIL" && r.status !== "WARN") continue;
        const label = humanLabel(r.ruleId);
        if (seen.has(label)) continue;
        seen.add(label);
        lines.push(`- ${label}: ${r.reason}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
