import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import {
  SCRUM_DECOMPOSITION_RULE,
  SCRUM_ESTIMATE_MISSING_RULE,
  SCRUM_NAME_MISMATCH_RULE,
  SCRUM_PV_MISSING_RULE,
} from "../rules/soft/scrum-board-rules.js";
import { ruleLabel } from "./rule-labels.js";

export type ScrumIssueCounts = {
  scrumEstimateMissing: number;
  scrumNameMismatch: number;
  pvMissing: number;
  decompositionMissing: number;
};

function cardHasRuleViolation(
  card: CardAudit,
  ruleId: string,
  statuses: Array<RuleResult["status"]> = ["FAIL", "WARN"],
): boolean {
  return card.results.some(
    (r) => r.ruleId === ruleId && statuses.includes(r.status),
  );
}

export function computeScrumIssueCounts(cards: CardAudit[]): ScrumIssueCounts {
  return {
    scrumEstimateMissing: cards.filter((c) =>
      cardHasRuleViolation(c, SCRUM_ESTIMATE_MISSING_RULE, ["FAIL", "WARN"]),
    ).length,
    scrumNameMismatch: cards.filter((c) =>
      cardHasRuleViolation(c, SCRUM_NAME_MISMATCH_RULE, ["WARN"]),
    ).length,
    pvMissing: cards.filter((c) =>
      cardHasRuleViolation(c, SCRUM_PV_MISSING_RULE, ["WARN", "FAIL"]),
    ).length,
    decompositionMissing: cards.filter((c) =>
      cardHasRuleViolation(c, SCRUM_DECOMPOSITION_RULE, ["WARN", "FAIL"]),
    ).length,
  };
}

function collectScrumRows(
  result: AuditResult,
  ruleId: string,
): Array<{ card: CardAudit; rule: RuleResult }> {
  const rows: Array<{ card: CardAudit; rule: RuleResult }> = [];
  for (const card of result.cards) {
    for (const rule of card.results) {
      if (rule.ruleId !== ruleId) continue;
      if (rule.status === "PASS") continue;
      if (rule.reason.includes("(SKIP)")) continue;
      rows.push({ card, rule });
    }
  }
  return rows;
}

function taskLine(card: CardAudit): string {
  const t = card.task;
  return `- **Доска ${t.boardId ?? "?"}** | [№${t.id ?? "?"}](${t.url ?? "—"}) — ${t.title ?? "(без названия)"}`;
}

export function buildScrumEstimateMarkdown(result: AuditResult): string[] {
  const lines: string[] = ["", "## Scrum / Смета", ""];

  const loaded = result.meta.scrumEstimateLoaded;
  const loadError = result.meta.scrumLoadError;
  if (loaded === false) {
    lines.push(
      `_Проверки Scrum/сметы пропущены: ${loadError ?? "Google Sheets недоступен"}_`,
    );
    return lines;
  }

  const sources = result.meta.scrumSources;
  if (sources?.length) {
    lines.push("**Источники:**", "");
    for (const s of sources) {
      const note = s.reason ? ` — ${s.reason}` : "";
      lines.push(
        `- \`${s.sheetName}\` (${s.source}): ${s.status}, raw=${s.rawRows}, parsed=${s.parsedRows}${note}`,
      );
    }
    lines.push("");
  }

  const matchStats = result.meta.scrumMatchStats;
  if (matchStats) {
    lines.push(
      `- Строк в Scrum/estimate: ${result.meta.scrumEstimateRows ?? "?"}`,
      `- Совпало по названию: ${matchStats.matched}`,
      `- Не найдено: ${matchStats.notFound}`,
      `- Расхождение названия: ${matchStats.nameMismatch}`,
      `- Без ПВ (оценка): ${matchStats.noPv}`,
      `- >20 ч без декомпозиции: ${matchStats.over20NoDecomp}`,
      "",
    );
  }

  const counts = result.meta.issueCounts;
  if (counts) {
    lines.push(
      `- Не найдено в смете: ${counts.scrumEstimateMissing ?? 0}`,
      `- Расхождение названия: ${counts.scrumNameMismatch ?? 0}`,
      `- Нет ПВ («Оценка (ч)»): ${counts.pvMissing ?? 0}`,
      `- >20 ч без декомпозиции: ${counts.decompositionMissing ?? 0}`,
      "",
    );
  }

  const sections: Array<[string, string]> = [
    [SCRUM_ESTIMATE_MISSING_RULE, "Не найдено в утверждённой смете"],
    [SCRUM_NAME_MISMATCH_RULE, "Название AppTask ≠ смета"],
    [SCRUM_PV_MISSING_RULE, "ПВ не указано"],
    [SCRUM_DECOMPOSITION_RULE, "Без декомпозиции (>20 ч)"],
  ];

  let any = false;
  for (const [ruleId, title] of sections) {
    const rows = collectScrumRows(result, ruleId);
    if (rows.length === 0) continue;
    any = true;
    lines.push(`### ${title}`, "");
    for (const { card, rule } of rows.slice(0, 15)) {
      lines.push(
        taskLine(card),
        `  - ${rule.status}: ${rule.reason}`,
        `  - rule: \`${ruleId}\` (${ruleLabel(ruleId)})`,
      );
    }
    lines.push("");
  }

  if (!any && loaded) {
    lines.push("_Нарушений по Scrum/смете не найдено._");
  }

  if (matchStats && matchStats.matchExamples.length > 0) {
    lines.push("### Примеры совпадений", "");
    for (const ex of matchStats.matchExamples) {
      lines.push(
        `- AppTask: «${ex.apptask.slice(0, 80)}» → Scrum: «${ex.scrum.slice(0, 80)}» (${ex.sheet})`,
      );
    }
    lines.push("");
  }

  if (matchStats && matchStats.mismatchExamples.length > 0) {
    lines.push("### Примеры несовпадений", "");
    for (const ex of matchStats.mismatchExamples) {
      lines.push(
        `- [${ex.kind}] AppTask: «${ex.apptask.slice(0, 80)}»${ex.scrum ? ` ≠ «${ex.scrum.slice(0, 80)}»` : ""}`,
      );
    }
    lines.push("");
  }

  return lines;
}
