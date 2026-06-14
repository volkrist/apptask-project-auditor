import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import {
  ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
  DONE_WITHOUT_TRACKING_RULE,
  ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
  IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
  TRACKING_HOURS_RULE_IDS,
  TRACKING_ON_NON_WORK_STATUS_RULE,
} from "../rules/soft/tracking-hours-rules.js";
import type { TaskTrackingHours } from "../tracking/tracking-hours-reader.js";
import { ruleLabel } from "./rule-labels.js";

export type TrackingIssueCounts = {
  doneWithoutTracking: number;
  inProgressWithoutRecentTracking: number;
  actualHoursExceededEstimate: number;
  estimateExceededWithoutComment: number;
  trackingOnNonWorkStatus: number;
};

export function computeTrackingIssueCounts(
  cards: CardAudit[],
): TrackingIssueCounts {
  const count = (ruleId: string) =>
    cards.filter((c) =>
      c.results.some((r) => r.ruleId === ruleId && r.status === "WARN"),
    ).length;

  return {
    doneWithoutTracking: count(DONE_WITHOUT_TRACKING_RULE),
    inProgressWithoutRecentTracking: count(
      IN_PROGRESS_WITHOUT_RECENT_TRACKING_RULE,
    ),
    actualHoursExceededEstimate: count(ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE),
    estimateExceededWithoutComment: count(
      ESTIMATE_EXCEEDED_WITHOUT_COMMENT_RULE,
    ),
    trackingOnNonWorkStatus: count(TRACKING_ON_NON_WORK_STATUS_RULE),
  };
}

function collectTrackingWarnRows(
  result: AuditResult,
): Array<{ card: CardAudit; rule: RuleResult }> {
  const rows: Array<{ card: CardAudit; rule: RuleResult }> = [];
  for (const card of result.cards) {
    for (const rule of card.results) {
      if (rule.status !== "WARN") continue;
      if (!TRACKING_HOURS_RULE_IDS.has(rule.ruleId)) continue;
      rows.push({ card, rule });
    }
  }
  return rows;
}

function taskLine(card: CardAudit): string {
  const t = card.task;
  return `- **Доска ${t.boardId ?? "?"}** | [№${t.id ?? "?"}](${t.url ?? "—"}) — ${t.title ?? "(без названия)"}`;
}

function formatHours(h: number): string {
  return `${h.toFixed(2)} ч`;
}

function parseEstimateFromReason(reason: string): number | null {
  const m = reason.match(/ПВ (\d+(?:\.\d+)?) ч/);
  return m ? Number(m[1]) : null;
}

function parseOverrunFromReason(reason: string): number | null {
  const m = reason.match(/перерасход (\d+(?:\.\d+)?)%/i);
  return m ? Number(m[1]) : null;
}

export function buildTrackingHoursMarkdown(result: AuditResult): string[] {
  const lines: string[] = ["", "## Фактическое время / Tracking", ""];

  if (!result.meta.trackingLoaded) {
    lines.push(
      `_Tracking DB: ${result.meta.trackingLoadError ?? "не загружен"}_`,
      "",
    );
    return lines;
  }

  lines.push(
    "_actualHours = SUM(total_time) / 3_600_000. manualAppendHours = SUM(append_total_time) / 3_600_000 (отдельно, не в правилах)._",
    `_Строк summaries: ${result.meta.trackingRowCount ?? "?"}`,
    "",
  );

  const counts = result.meta.issueCounts;
  if (counts) {
    lines.push(
      "### Сводка tracking-hours",
      `- done без трекинга: ${counts.doneWithoutTracking ?? 0}`,
      `- in progress без recent tracking: ${counts.inProgressWithoutRecentTracking ?? 0}`,
      `- факт > ПВ (+порог): ${counts.actualHoursExceededEstimate ?? 0}`,
      `- перерасход без комментария: ${counts.estimateExceededWithoutComment ?? 0}`,
      `- трекинг вне рабочего статуса: ${counts.trackingOnNonWorkStatus ?? 0}`,
      "",
    );
  }

  const byTaskKey = result.meta.trackingByTaskKey ?? {};
  const warnRows = collectTrackingWarnRows(result);
  const shown = new Set<string>();

  for (const { card, rule } of warnRows) {
    const key = `${card.task.boardId}:${card.task.id}`;
    if (shown.has(key)) continue;
    shown.add(key);

    const metrics: TaskTrackingHours | undefined = byTaskKey[key];
    const actual = metrics?.actualHours ?? 0;
    const append = metrics?.manualAppendHours ?? 0;
    const estimate =
      parseEstimateFromReason(rule.reason) ??
      parseEstimateFromReason(
        card.results.find((r) => r.ruleId === ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE)
          ?.reason ?? "",
      );
    const overrun =
      parseOverrunFromReason(rule.reason) ??
      parseOverrunFromReason(
        card.results.find((r) => r.ruleId === ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE)
          ?.reason ?? "",
      );

    const users =
      metrics?.perUser
        .slice(0, 3)
        .map((u) => `${u.userName ?? u.userId} (${formatHours(u.actualHours)})`)
        .join(", ") ?? "—";

    lines.push(
      taskLine(card),
      `  - actual: ${formatHours(actual)} | manual append: ${formatHours(append)}${
        estimate != null ? ` | ПВ: ${formatHours(estimate)}` : ""
      }${overrun != null ? ` | overrun: ${overrun.toFixed(1)}%` : ""}`,
      `  - last tracking: ${metrics?.lastTrackingDate ?? "—"} | users: ${metrics?.usersCount ?? 0} (${users})`,
    );

    for (const r of card.results) {
      if (r.status !== "WARN" || !TRACKING_HOURS_RULE_IDS.has(r.ruleId)) continue;
      lines.push(`  - ${ruleLabel(r.ruleId)}: ${r.reason}`);
    }
    lines.push("");
  }

  if (warnRows.length === 0) {
    lines.push("_Нарушений tracking-hours не найдено._");
  }

  return lines;
}
