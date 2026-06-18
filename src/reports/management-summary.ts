import type { AuditResult, CardAudit, RuleResult } from "../rules/rule-types.js";
import {
  ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE,
  DONE_WITHOUT_TRACKING_RULE,
} from "../rules/soft/tracking-hours-rules.js";
import { SCRUM_ESTIMATE_MISSING_RULE } from "../rules/soft/scrum-board-rules.js";

export type HighlightItem = { text: string; count: number };

export type RiskGroup = {
  title: string;
  count: number;
  whyImportant: string;
  action: string;
};

export type TopTaskItem = {
  id: string;
  title: string;
  url: string;
  problem: string;
  assignees: string;
  action: string;
  sortKey: number;
};

export type ManagementSummary = {
  highlights: HighlightItem[];
  priorities: string[];
  risks: RiskGroup[];
  topTasks: TopTaskItem[];
  introNarrative: string;
  briefConclusion: string;
  scrumBullets: string[];
  trackingBullets: string[];
};

function countRule(
  cards: CardAudit[],
  ruleId: string,
  statuses: Array<RuleResult["status"]> = ["FAIL", "WARN"],
): number {
  return cards.filter((c) =>
    c.results.some((r) => r.ruleId === ruleId && statuses.includes(r.status)),
  ).length;
}

function cardRule(
  card: CardAudit,
  ruleId: string,
): RuleResult | undefined {
  return card.results.find(
    (r) => r.ruleId === ruleId && r.status !== "PASS",
  );
}

function assigneeLine(card: CardAudit): string {
  const names = card.task.assignees?.filter(Boolean) ?? [];
  return names.length > 0 ? names.join(", ") : "не назначен";
}

function humanizeReason(reason: string): string {
  return reason
    .replace(/\s*\(SKIP\)\s*$/i, "")
    .replace(/^[^:]+:\s*/, "")
    .trim();
}

function taskPriority(card: CardAudit): number {
  if (cardRule(card, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE)) return 1;
  if (cardRule(card, SCRUM_ESTIMATE_MISSING_RULE)) return 2;
  if (cardRule(card, "in_progress_stale")) return 3;
  if (cardRule(card, DONE_WITHOUT_TRACKING_RULE)) return 4;
  if (cardRule(card, "estimate_exceeded_without_comment")) return 1.5;
  if (cardRule(card, "in_progress_without_recent_tracking")) return 3.5;
  if (cardRule(card, "rework_without_reason")) return 5;
  return 99;
}

function topTaskProblem(card: CardAudit): string {
  const pv = cardRule(card, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (pv) return humanizeReason(pv.reason) || "фактическое время превысило ПВ";

  const scrum = cardRule(card, SCRUM_ESTIMATE_MISSING_RULE);
  if (scrum) return humanizeReason(scrum.reason) || "задача не найдена в Scrum/смете";

  const stale = cardRule(card, "in_progress_stale");
  if (stale) return humanizeReason(stale.reason) || "задача в работе без свежего обновления";

  const done = cardRule(card, DONE_WITHOUT_TRACKING_RULE);
  if (done) return humanizeReason(done.reason) || "закрыта без фактического времени";

  const noComment = cardRule(card, "estimate_exceeded_without_comment");
  if (noComment) return humanizeReason(noComment.reason) || "перерасход ПВ без комментария";

  const trackingStale = cardRule(card, "in_progress_without_recent_tracking");
  if (trackingStale) {
    return humanizeReason(trackingStale.reason) || "в работе без свежего трекинга";
  }

  const rework = cardRule(card, "rework_without_reason");
  if (rework) return humanizeReason(rework.reason) || "возврат на доработку без причины";

  const first = card.results.find((r) => r.status !== "PASS");
  return first ? humanizeReason(first.reason) || first.reason : "требует проверки";
}

function topTaskAction(card: CardAudit): string {
  if (cardRule(card, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE)) {
    return "ПМу добавить комментарий с причиной перерасхода.";
  }
  if (cardRule(card, "estimate_exceeded_without_comment")) {
    return "ПМу добавить комментарий с причиной перерасхода.";
  }
  if (cardRule(card, SCRUM_ESTIMATE_MISSING_RULE)) {
    return "Привязать задачу к Scrum/смете или согласовать как доп. работу.";
  }
  if (cardRule(card, "in_progress_stale")) {
    return "Исполнителю или ПМу обновить статус или комментарий.";
  }
  if (cardRule(card, "in_progress_without_recent_tracking")) {
    return "Исполнителю обновить трекинг или статус задачи.";
  }
  if (cardRule(card, DONE_WITHOUT_TRACKING_RULE)) {
    return "Проверить, куда был записан трекинг.";
  }
  if (cardRule(card, "rework_without_reason")) {
    return "Добавить конкретную причину возврата.";
  }
  return "Проверить карточку и устранить нарушения.";
}

function buildTopTasks(cards: CardAudit[], limit = 15): TopTaskItem[] {
  const seen = new Set<string>();
  const items: TopTaskItem[] = [];

  for (const card of cards) {
    if (!card.results.some((r) => r.status !== "PASS")) continue;
    const key = `${card.task.boardId ?? "?"}:${card.task.id ?? "?"}`;
    if (seen.has(key)) continue;
    const priority = taskPriority(card);
    if (priority >= 99) continue;
    seen.add(key);
    items.push({
      id: card.task.id ?? "?",
      title: card.task.title ?? "(без названия)",
      url: card.task.url ?? "—",
      problem: topTaskProblem(card),
      assignees: assigneeLine(card),
      action: topTaskAction(card),
      sortKey: priority,
    });
  }

  return items
    .sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id, undefined, { numeric: true }))
    .slice(0, limit);
}

function buildHighlights(result: AuditResult): HighlightItem[] {
  const c = result.meta.issueCounts;
  const cards = result.cards;
  const items: HighlightItem[] = [];

  const stale = c?.staleInProgressIssues ?? countRule(cards, "in_progress_stale");
  if (stale > 0) {
    items.push({
      count: stale,
      text: `${stale} ${taskWord(stale)} в работе без свежего обновления`,
    });
  }

  const scrumMissing = c?.scrumEstimateMissing ?? countRule(cards, SCRUM_ESTIMATE_MISSING_RULE);
  if (scrumMissing > 0) {
    items.push({
      count: scrumMissing,
      text: `${scrumMissing} ${taskWord(scrumMissing)} не найдены в Scrum/смете`,
    });
  }

  const pvExceeded = c?.actualHoursExceededEstimate ?? countRule(cards, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (pvExceeded > 0) {
    items.push({
      count: pvExceeded,
      text: `${pvExceeded} ${taskWord(pvExceeded)} превысили ПВ`,
    });
  }

  const doneNoTracking = c?.doneWithoutTracking ?? countRule(cards, DONE_WITHOUT_TRACKING_RULE);
  if (doneNoTracking > 0) {
    items.push({
      count: doneNoTracking,
      text: `${doneNoTracking} ${taskWord(doneNoTracking)} закрыты без трекинга`,
    });
  }

  const rework = countRule(cards, "rework_without_reason");
  if (rework > 0) {
    items.push({
      count: rework,
      text: `${rework} ${returnWord(rework)} на доработку без причины`,
    });
  }

  const noComment = c?.estimateExceededWithoutComment ?? countRule(cards, "estimate_exceeded_without_comment");
  if (noComment > 0 && pvExceeded === 0) {
    items.push({
      count: noComment,
      text: `${noComment} ${taskWord(noComment)} с перерасходом без комментария`,
    });
  }

  return items;
}

function taskWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "задача";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "задачи";
  return "задач";
}

function returnWord(n: number): string {
  return n === 1 ? "возврат" : "возвратов";
}

function buildPriorities(highlights: HighlightItem[], result: AuditResult): string[] {
  const counts = result.meta.issueCounts;
  const cards = result.cards;
  const out: string[] = [];

  const stale = counts?.staleInProgressIssues ?? countRule(cards, "in_progress_stale");
  if (stale > 0) out.push("Обновить задачи в работе без движения.");

  const scrumMissing = counts?.scrumEstimateMissing ?? countRule(cards, SCRUM_ESTIMATE_MISSING_RULE);
  if (scrumMissing > 0) out.push("Проверить задачи, которых нет в Scrum/смете.");

  const pvExceeded = counts?.actualHoursExceededEstimate ?? countRule(cards, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (pvExceeded > 0) out.push("Разобрать превышения ПВ.");

  const noComment = counts?.estimateExceededWithoutComment ?? countRule(cards, "estimate_exceeded_without_comment");
  if (noComment > 0) out.push("Добавить комментарии к перерасходам.");

  const doneNoTracking = counts?.doneWithoutTracking ?? countRule(cards, DONE_WITHOUT_TRACKING_RULE);
  if (doneNoTracking > 0) out.push("Проверить закрытые задачи без фактического времени.");

  const rework = countRule(cards, "rework_without_reason");
  if (rework > 0) out.push("Указать причины возвратов на доработку.");

  if (out.length === 0 && highlights.length > 0) {
    out.push("Разобрать задачи из списка «Что важно сейчас».");
  }

  return out.slice(0, 5);
}

function buildRisks(result: AuditResult): RiskGroup[] {
  const c = result.meta.issueCounts;
  const cards = result.cards;
  const risks: RiskGroup[] = [];

  const stale = c?.staleInProgressIssues ?? countRule(cards, "in_progress_stale");
  if (stale > 0) {
    risks.push({
      title: "Задачи не обновляются",
      count: stale,
      whyImportant: "Непонятно, ведётся работа или задача забыта.",
      action: "Исполнителю или ПМу обновить статус/комментарий.",
    });
  }

  const scrumMissing = c?.scrumEstimateMissing ?? countRule(cards, SCRUM_ESTIMATE_MISSING_RULE);
  if (scrumMissing > 0) {
    risks.push({
      title: "Задачи не найдены в Scrum/смете",
      count: scrumMissing,
      whyImportant: "Нельзя нормально контролировать ПВ и состав работ.",
      action: "Привязать задачи к Scrum/смете или согласовать как доп. работы.",
    });
  }

  const pvExceeded = c?.actualHoursExceededEstimate ?? countRule(cards, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (pvExceeded > 0) {
    risks.push({
      title: "Фактическое время превысило ПВ",
      count: pvExceeded,
      whyImportant: "Есть перерасход бюджета/оценки.",
      action: "ПМу добавить комментарий с причиной перерасхода.",
    });
  }

  const doneNoTracking = c?.doneWithoutTracking ?? countRule(cards, DONE_WITHOUT_TRACKING_RULE);
  if (doneNoTracking > 0) {
    risks.push({
      title: "Закрытые задачи без трекинга",
      count: doneNoTracking,
      whyImportant: "Задача закрыта, но нет подтверждённого времени.",
      action: "Проверить, куда был записан трекинг.",
    });
  }

  const rework = countRule(cards, "rework_without_reason");
  if (rework > 0) {
    risks.push({
      title: "Возврат на доработку без причины",
      count: rework,
      whyImportant: "Исполнитель не понимает, что именно исправлять.",
      action: "Добавить конкретную причину возврата.",
    });
  }

  return risks;
}

function buildIntroNarrative(result: AuditResult, risks: RiskGroup[]): string {
  const name = result.meta.projectName;
  if (risks.length === 0) {
    return `Проверен проект ${name}. Серьёзных проблем по оформлению задач, связке со Scrum/сметой и фактическому времени не обнаружено.`;
  }

  const themes: string[] = [];
  if (risks.some((r) => r.title.includes("Scrum"))) themes.push("связке со Scrum/сметой");
  if (risks.some((r) => r.title.includes("ПВ") || r.title.includes("трекинг"))) {
    themes.push("фактическому времени");
  }
  if (risks.some((r) => r.title.includes("обновляются"))) themes.push("актуальности статусов");

  const themeText =
    themes.length > 0
      ? themes.join(", ")
      : "оформлению задач, связке со Scrum/сметой и фактическому времени";

  const riskParts = risks.slice(0, 3).map((r) => {
    if (r.title.includes("Scrum")) return "часть задач не синхронизирована со сметой";
    if (r.title.includes("ПВ")) return "есть перерасход ПВ без объяснений";
    if (r.title.includes("обновляются")) return "часть задач в работе давно не обновлялась";
    if (r.title.includes("трекинга")) return "есть закрытые задачи без подтверждённого времени";
    if (r.title.includes("доработку")) return "есть возвраты без понятной причины";
    return r.title.toLowerCase();
  });

  const uniqueRisks = [...new Set(riskParts)];
  return `Проверен проект ${name}. Аудит нашёл проблемы по ${themeText}. Основные риски: ${uniqueRisks.join(", ")}.`;
}

function buildScrumBullets(result: AuditResult): string[] {
  const loaded = result.meta.scrumEstimateLoaded;
  if (loaded === false) {
    return [`Проверки Scrum/сметы пропущены: ${result.meta.scrumLoadError ?? "данные недоступны"}.`];
  }

  const bullets: string[] = [];
  const rowCount = result.meta.scrumEstimateRows;
  const matchStats = result.meta.scrumMatchStats;
  const c = result.meta.issueCounts;

  if (rowCount != null) {
    bullets.push(`В Scrum найдено ${rowCount} строк.`);
  }
  if (matchStats) {
    bullets.push(`С задачами AppTask совпало ${matchStats.matched}.`);
  }

  const missing = c?.scrumEstimateMissing ?? matchStats?.notFound ?? 0;
  if (missing > 0) {
    bullets.push(`Не найдено в смете ${missing} задач.`);
  } else if (loaded) {
    bullets.push("Все проверенные задачи найдены в смете.");
  }

  const nameMismatch = c?.scrumNameMismatch ?? matchStats?.nameMismatch ?? 0;
  if (nameMismatch > 0) {
    bullets.push(`Названия отличаются у ${nameMismatch} задач.`);
  }

  const pvMissing = c?.pvMissing ?? matchStats?.noPv ?? 0;
  if (pvMissing === 0 && loaded) {
    bullets.push("ПВ заполнено, проблем с отсутствием ПВ нет.");
  } else if (pvMissing > 0) {
    bullets.push(`У ${pvMissing} задач не указано ПВ в смете.`);
  }

  const decomp = c?.decompositionMissing ?? matchStats?.over20NoDecomp ?? 0;
  if (decomp === 0 && loaded) {
    bullets.push("Декомпозиция задач >20 ч в норме.");
  } else if (decomp > 0) {
    bullets.push(`${decomp} задач >20 ч без декомпозиции.`);
  }

  return bullets;
}

function buildTrackingBullets(result: AuditResult): string[] {
  const c = result.meta.issueCounts;
  const cards = result.cards;
  const bullets: string[] = [];

  if (!result.meta.trackingLoaded) {
    return [`Данные трекинга недоступны: ${result.meta.trackingLoadError ?? "не загружены"}.`];
  }

  const pvExceeded = c?.actualHoursExceededEstimate ?? countRule(cards, ACTUAL_HOURS_EXCEEDS_ESTIMATE_RULE);
  if (pvExceeded > 0) {
    bullets.push(`${pvExceeded} ${taskWord(pvExceeded)} превысили ПВ.`);
  } else {
    bullets.push("Превышений ПВ не найдено.");
  }

  const noComment = c?.estimateExceededWithoutComment ?? countRule(cards, "estimate_exceeded_without_comment");
  if (noComment > 0) {
    bullets.push(`${noComment} ${taskWord(noComment)} с перерасходом без комментария.`);
  }

  const doneNoTracking = c?.doneWithoutTracking ?? countRule(cards, DONE_WITHOUT_TRACKING_RULE);
  if (doneNoTracking > 0) {
    bullets.push(`${doneNoTracking} закрытые ${taskWord(doneNoTracking)} без трекинга.`);
  }

  const trackingStale = c?.inProgressWithoutRecentTracking ?? countRule(cards, "in_progress_without_recent_tracking");
  if (trackingStale > 0) {
    bullets.push(`${trackingStale} ${taskWord(trackingStale)} в работе без свежего трекинга/движения.`);
  }

  const outsideStatus = c?.trackingOnNonWorkStatus ?? countRule(cards, "tracking_on_non_work_status");
  if (outsideStatus === 0) {
    bullets.push("Трекинга вне рабочего статуса нет.");
  } else {
    bullets.push(`${outsideStatus} ${taskWord(outsideStatus)} с трекингом вне рабочего статуса.`);
  }

  return bullets;
}

function buildBriefConclusion(result: AuditResult, risks: RiskGroup[]): string {
  const { meta } = result;
  const status =
    meta.failCount > 0
      ? "Требует доработки"
      : meta.warnCount > 0
        ? "Есть предупреждения"
        : "Проблем не найдено";

  const parts = [
    `Проверено ${meta.cardsChecked} задач.`,
    `Критичных: ${meta.failCount}, предупреждений: ${meta.warnCount}.`,
    `Статус: ${status}.`,
  ];

  if (risks.length > 0) {
    const top = risks
      .slice(0, 3)
      .map((r) => `${r.title.toLowerCase()} (${r.count})`)
      .join("; ");
    parts.push(`Главное: ${top}.`);
  }

  return parts.join(" ");
}

export function buildManagementSummary(result: AuditResult): ManagementSummary {
  const highlights = buildHighlights(result);
  const risks = buildRisks(result);
  const topTasks = buildTopTasks(result.cards);
  const priorities = buildPriorities(highlights, result);

  return {
    highlights,
    priorities,
    risks,
    topTasks,
    introNarrative: buildIntroNarrative(result, risks),
    briefConclusion: buildBriefConclusion(result, risks),
    scrumBullets: buildScrumBullets(result),
    trackingBullets: buildTrackingBullets(result),
  };
}

export function formatHighlightsList(highlights: HighlightItem[]): string {
  if (highlights.length === 0) return "• Существенных рисков не выявлено";
  return highlights.map((h) => `• ${h.text}`).join("\n");
}

export function formatPrioritiesList(priorities: string[]): string {
  if (priorities.length === 0) return "• Дополнительных действий не требуется";
  return priorities.map((p, i) => `${i + 1}. ${p}`).join("\n");
}
