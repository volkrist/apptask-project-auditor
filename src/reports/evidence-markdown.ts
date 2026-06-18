import type { AuditResult, CardAudit, EntityFinding } from "../rules/rule-types.js";
import { ruleCondition } from "./rule-conditions.js";
import { ruleLabel } from "./rule-labels.js";
import { escapeTableCell } from "./report-links.js";
import { simplifyReasonText } from "./report-presentation.js";

export type TaskViolationGroup = {
  ruleId: string;
  status: "FAIL" | "WARN";
  cards: CardAudit[];
  sampleReason: string;
};

function humanLabel(ruleId: string): string {
  return ruleLabel(ruleId);
}

function cardLink(card: CardAudit): string {
  const t = card.task;
  const id = t.id ? `№${t.id}` : "без номера";
  const title = t.title ?? "(без названия)";
  if (t.url) return `[${id} — ${escapeTableCell(title)}](${t.url})`;
  return `${id} — ${escapeTableCell(title)}`;
}

export function parseScrumTitleMismatch(
  reason: string,
): { actual: string; expected: string } | null {
  const m = reason.match(/AppTask: «(.+)» ≠ смета: «(.+)»/);
  if (!m) return null;
  return { actual: m[1]!, expected: m[2]! };
}

function scrumDiff(actual: string, expected: string): string {
  if (actual === expected) return "—";
  const a = actual.trim();
  const b = expected.trim();
  if (a.length !== b.length && a.replace(/\s/g, "") === b.replace(/\s/g, "")) {
    return "пробелы / регистр";
  }
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) {
      return `«${a.slice(i, i + 12)}» ≠ «${b.slice(i, i + 12)}»`;
    }
  }
  return "разные строки";
}

function formatScrumTitleTable(group: TaskViolationGroup): string[] {
  const lines = [
    "",
    "| Карточка | AppTask | Смета / Scrum | Расхождение |",
    "| -------- | ------- | ------------- | ----------- |",
  ];
  for (const card of group.cards) {
    const r = card.results.find((x) => x.ruleId === group.ruleId);
    const parsed = r ? parseScrumTitleMismatch(r.reason) : null;
    const actual = parsed?.actual ?? simplifyReasonText(r?.reason ?? "—");
    const expected = parsed?.expected ?? "—";
    const diff = parsed ? scrumDiff(parsed.actual, parsed.expected) : "—";
    lines.push(
      `| ${cardLink(card)} | ${escapeTableCell(actual)} | ${escapeTableCell(expected)} | ${escapeTableCell(diff)} |`,
    );
  }
  return lines;
}

function formatDefaultTaskTable(group: TaskViolationGroup): string[] {
  const lines = [
    "",
    "| Карточка | Статус | Исполнитель | Фактическое значение | Ожидаемое значение |",
    "| -------- | ------ | ----------- | -------------------- | ------------------ |",
  ];
  for (const card of group.cards) {
    const t = card.task;
    const r = card.results.find((x) => x.ruleId === group.ruleId);
    const fact = simplifyReasonText(r?.reason ?? "—");
    const expected = expectedForRule(group.ruleId, r?.reason ?? "");
    lines.push(
      `| ${cardLink(card)} | ${escapeTableCell(t.status ?? "—")} | ${escapeTableCell(t.assignees[0] ?? "—")} | ${escapeTableCell(fact)} | ${escapeTableCell(expected)} |`,
    );
  }
  return lines;
}

function expectedForRule(ruleId: string, _reason: string): string {
  const map: Record<string, string> = {
    assignee_present: "назначен исполнитель",
    description_present: "описание заполнено (≥80 символов)",
    ui_has_mockup_link: "ссылка на макет",
    verified_success_comment: "комментарий «проверено» после завершения",
    open_questions_closed: "ответ другого участника на вопрос",
    unresolved_question_keywords_in_card: "нет маркеров незакрытого вопроса",
    scrum_task_in_estimate: "задача в утверждённой смете",
    done_task_without_tracking: "фактическое время > 0",
    blocked_tag_present: "тег blocked/блок",
    blocked_task_reason: "причина блокировки в комментарии",
  };
  return map[ruleId] ?? ruleCondition(ruleId);
}

export function formatTaskViolationBlock(group: TaskViolationGroup): string[] {
  const count = group.cards.length;
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel(group.ruleId)}`,
    "",
    `Условие: ${ruleCondition(group.ruleId)}.`,
    `Результат: ${group.status} — найдено ${count} ${count === 1 ? "карточка" : "карточек"}.`,
  ];

  if (group.ruleId === "scrum_title_matches_estimate") {
    lines.push(...formatScrumTitleTable(group));
  } else {
    lines.push(...formatDefaultTaskTable(group));
  }

  return lines;
}

function formatTrackingAnomalyTable(findings: EntityFinding[]): string[] {
  const rows = findings.flatMap((f) => f.trackingRows ?? []);
  if (rows.length === 0) return [];

  const lines = [
    "",
    "| Дата | Пользователь | Карточка | Факт | Лимит |",
    "| ---- | ------------ | -------- | ---- | ----- |",
  ];

  for (const row of rows) {
    const cardCol = row.tasks
      .map((t) => {
        const flow = t.isFlow ? " (потоковая)" : "";
        if (t.url) {
          return `[№${t.id} — ${escapeTableCell(t.title)}](${t.url})${flow}`;
        }
        return `№${t.id} — ${escapeTableCell(t.title)}${flow}`;
      })
      .join("; ");
    lines.push(
      `| ${row.date} | ${escapeTableCell(row.userName)} | ${cardCol} | ${row.hours} ч | ${row.limitHours} ч |`,
    );
  }
  return lines;
}

export function formatEntityViolationBlock(finding: EntityFinding): string[] {
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel(finding.ruleId)}`,
    "",
    `Условие: ${ruleCondition(finding.ruleId)}.`,
    `Результат: ${finding.status} — ${simplifyReasonText(finding.reason)}.`,
  ];

  if (finding.ruleId === "tracking_daily_anomaly") {
    lines.push(
      "",
      "Потоковые/сервисные карточки исключены из task-level аудита, но их фактическое время учитывается в проверке дневного списания времени.",
    );
    lines.push(...formatTrackingAnomalyTable([finding]));
    return lines;
  }

  if (finding.ruleId === "task_type_classification" && finding.details?.length) {
    lines.push("", "| Показатель | Значение |", "| ---------- | -------- |");
    for (const d of finding.details) {
      const [label, value] = d.includes(":") ? d.split(/:\s*/, 2) : [d, ""];
      lines.push(`| ${escapeTableCell(label ?? d)} | ${escapeTableCell(value ?? "")} |`);
    }
    return lines;
  }

  lines.push(
    "",
    "| Объект | Источник | Фактическое значение | Ожидаемое значение | Ссылка |",
    "| ------ | -------- | -------------------- | ------------------ | ------ |",
    `| ${escapeTableCell(finding.objectLabel)} | ${escapeTableCell(finding.source ?? "—")} | ${escapeTableCell(finding.actualValue ?? "—")} | ${escapeTableCell(finding.expectedValue ?? "—")} | ${finding.link ? `[открыть](${finding.link})` : "—"} |`,
  );

  if (finding.details && finding.details.length > 0) {
    lines.push("", "Детали:");
    for (const d of finding.details) {
      lines.push(`* ${d}`);
    }
  }

  return lines;
}

export function formatTrackingDailyAnomalyGroup(
  findings: EntityFinding[],
): string[] {
  if (findings.length === 0) return [];
  const lines: string[] = [
    "",
    `#### Проверка: ${humanLabel("tracking_daily_anomaly")}`,
    "",
    `Условие: ${ruleCondition("tracking_daily_anomaly")}.`,
    `Результат: WARN — найдено ${findings.length} ${findings.length === 1 ? "случай" : "случаев"}.`,
    "",
    "Потоковые/сервисные карточки исключены из task-level аудита, но их фактическое время учитывается в проверке дневного списания времени.",
  ];
  lines.push(...formatTrackingAnomalyTable(findings));
  return lines;
}

export function buildTaskLookup(result: AuditResult): Map<string, CardAudit["task"]> {
  const map = new Map<string, CardAudit["task"]>();
  for (const card of result.cards) {
    if (card.task.id) map.set(card.task.id, card.task);
  }
  const excluded = result.meta.excludedFlowCards ?? [];
  for (const ex of excluded) {
    if (!ex.id || map.has(ex.id)) continue;
    map.set(ex.id, {
      id: ex.id,
      url: ex.url,
      title: ex.title,
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
    });
  }
  return map;
}
